/**
 * Global search (command palette backend), against the verified disposable
 * test database: every entity type is findable, results are tenant-scoped on
 * every query, groups a role may not view are not queried at all, and the
 * search is bounded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { SEARCH_MAX_LENGTH, SEARCH_PER_TYPE, normalizeQuery, searchWorkspace, type SearchGroup } from "@/lib/search/service";
import { makeAgent } from "@/lib/control/__tests__/fixtures";

const RUN_ID = `test_search_${Date.now()}`;
const TOKEN = `zq${Date.now().toString(36)}`; // a string no other test data contains

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string; slug: string };
const ids: Record<string, string> = {};

const as = (organizationId: string, role: MemberRole = "SECURITY") => ({ organizationId, role });
const types = (groups: SearchGroup[]) => groups.map((g) => g.type);
const find = (groups: SearchGroup[], type: string) => groups.find((g) => g.type === type)?.results ?? [];

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Search A", slug: `${RUN_ID}-a`, plan: "enterprise" } });
  orgB = await prisma.organization.create({ data: { name: "Search B", slug: `${RUN_ID}-b`, plan: "enterprise" } });
  const a = await makeAgent(orgA.id, { slug: `${TOKEN}-agent`, owner: "Revenue" });
  agentA = a;
  ids.agent = a.id;
  const policy = await prisma.policy.create({ data: { organizationId: orgA.id, name: `${TOKEN} export policy`, decision: "BLOCK", action: "crm.export" } });
  ids.policy = policy.id;
  const event = await prisma.activityEvent.create({ data: { organizationId: orgA.id, agentId: a.id, eventType: "ACTION", action: `${TOKEN}.read`, resource: `${TOKEN}-resource` } });
  ids.event = event.id;
  const evaluation = await prisma.policyEvaluation.create({ data: { organizationId: orgA.id, agentId: a.id, action: `${TOKEN}.approve`, decision: "REQUIRE_APPROVAL", reason: "x" } });
  const approval = await prisma.approvalRequest.create({ data: { organizationId: orgA.id, agentId: a.id, policyEvaluationId: evaluation.id, action: `${TOKEN}.approve`, reason: "x" } });
  ids.approval = approval.id;
  const alert = await prisma.securityAlert.create({ data: { organizationId: orgA.id, agentId: a.id, type: "BLOCK_SPIKE", severity: "HIGH", title: `${TOKEN} alert`, description: "d" } });
  ids.alert = alert.id;
  const incident = await prisma.incident.create({
    data: { organizationId: orgA.id, agentId: a.id, number: 4242, clusterKey: `search:${TOKEN}`, anchorType: "SECURITY_ALERT", anchorId: alert.id, title: `${TOKEN} incident`, severity: "HIGH", openedVia: "MANUAL" },
  });
  ids.incident = incident.id;
  const audit = await prisma.auditEvent.create({ data: { organizationId: orgA.id, actorType: "SYSTEM", eventType: "policy.created", entityType: "Policy", entityId: policy.id, action: `${TOKEN}.audit` } });
  ids.audit = audit.id;

  // Another tenant with the SAME searchable strings: none of it may ever appear for org A.
  const b = await makeAgent(orgB.id, { slug: `${TOKEN}-agent-b`, owner: "Revenue" });
  await prisma.policy.create({ data: { organizationId: orgB.id, name: `${TOKEN} export policy B`, decision: "BLOCK", action: "crm.export" } });
  await prisma.activityEvent.create({ data: { organizationId: orgB.id, agentId: b.id, eventType: "ACTION", action: `${TOKEN}.read.b`, resource: `${TOKEN}-resource-b` } });
  const alertB = await prisma.securityAlert.create({ data: { organizationId: orgB.id, agentId: b.id, type: "BLOCK_SPIKE", severity: "HIGH", title: `${TOKEN} alert B`, description: "d" } });
  await prisma.incident.create({
    data: { organizationId: orgB.id, agentId: b.id, number: 4242, clusterKey: `search-b:${TOKEN}`, anchorType: "SECURITY_ALERT", anchorId: alertB.id, title: `${TOKEN} incident B`, severity: "HIGH", openedVia: "MANUAL" },
  });
  await prisma.auditEvent.create({ data: { organizationId: orgB.id, actorType: "SYSTEM", eventType: "policy.created", entityType: "Policy", entityId: "x", action: `${TOKEN}.audit.b` } });
}, 60_000);

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.incidentActivity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.incident.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
}, 60_000);

describe("normalizeQuery", () => {
  it("needs at least two characters, collapses whitespace, and caps length", () => {
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("  crm   export ")).toBe("crm export");
    expect(normalizeQuery("x".repeat(500))!.length).toBe(SEARCH_MAX_LENGTH);
  });
});

describe("finds the real entities of the caller's organization", () => {
  it("returns every entity type, each with a link to the page that exists for it", async () => {
    const { groups } = await searchWorkspace(as(orgA.id), TOKEN);
    expect(types(groups).sort()).toEqual(["agent", "alert", "approval", "audit", "event", "incident", "policy"]);
    expect(find(groups, "agent")[0]).toMatchObject({ id: ids.agent, href: `/agents/${agentA.slug}` });
    expect(find(groups, "policy")[0]).toMatchObject({ id: ids.policy, href: `/policies/${ids.policy}/edit` });
    expect(find(groups, "approval")[0]).toMatchObject({ id: ids.approval, href: `/approvals/${ids.approval}` });
    expect(find(groups, "incident")[0]).toMatchObject({ id: ids.incident, href: `/incidents/${ids.incident}` });
    expect(find(groups, "alert")[0]).toMatchObject({ id: ids.alert, href: `/security/${ids.alert}` });
    expect(find(groups, "event")[0]).toMatchObject({ id: ids.event, href: `/activity/${ids.event}` });
    expect(find(groups, "audit")[0]).toMatchObject({ id: ids.audit, href: `/audit/${ids.audit}` });
  });

  it("matches case-insensitively and by incident number (INC-4242)", async () => {
    expect(find((await searchWorkspace(as(orgA.id), TOKEN.toUpperCase())).groups, "agent")).toHaveLength(1);
    for (const q of ["INC-4242", "inc4242", "inc-4242"]) {
      expect(find((await searchWorkspace(as(orgA.id), q)).groups, "incident").map((r) => r.id), q).toContain(ids.incident);
    }
  });

  it("an approval can be found by the start of its id", async () => {
    expect(find((await searchWorkspace(as(orgA.id), ids.approval.slice(0, 10))).groups, "approval").map((r) => r.id)).toContain(ids.approval);
  });

  it("no match, and too-short queries, return no groups — never an error and never 'everything'", async () => {
    expect((await searchWorkspace(as(orgA.id), `${TOKEN}-nothing-like-this`)).groups).toEqual([]);
    expect((await searchWorkspace(as(orgA.id), "a")).groups).toEqual([]);
    expect((await searchWorkspace(as(orgA.id), "")).groups).toEqual([]);
  });

  it("a query made of LIKE wildcards does not match everything", async () => {
    for (const q of ["%%", "__", "%_"]) expect((await searchWorkspace(as(orgA.id), q)).groups, q).toEqual([]);
  });
});

describe("tenant isolation: another organization's matching records never appear", () => {
  it("returns only this organization's rows even though the other has identical searchable strings", async () => {
    const { groups } = await searchWorkspace(as(orgA.id), TOKEN);
    const everything = groups.flatMap((g) => g.results);
    expect(everything.length).toBeGreaterThan(0);
    for (const r of everything) expect(r.title + r.subtitle + r.href).not.toMatch(/\bB\b|-b\b|\.b\b/);
    const foreignIds = [
      ...(await prisma.agent.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
      ...(await prisma.policy.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
      ...(await prisma.incident.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
      ...(await prisma.securityAlert.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
      ...(await prisma.activityEvent.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
      ...(await prisma.auditEvent.findMany({ where: { organizationId: orgB.id }, select: { id: true } })),
    ].map((r) => r.id);
    for (const r of everything) expect(foreignIds).not.toContain(r.id);
    // And the other tenant sees only its own.
    const theirs = (await searchWorkspace(as(orgB.id), TOKEN)).groups.flatMap((g) => g.results);
    for (const r of theirs) expect(everything.map((x) => x.id)).not.toContain(r.id);
    expect(theirs.length).toBeGreaterThan(0);
  });

  it("the same incident NUMBER exists in both organizations, and each only finds its own", async () => {
    const a = find((await searchWorkspace(as(orgA.id), "INC-4242")).groups, "incident");
    const b = find((await searchWorkspace(as(orgB.id), "INC-4242")).groups, "incident");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
    expect(a[0].title).toContain(TOKEN);
    expect(b[0].title).toContain("B");
  });

  it("an audit entity-id search cannot reach another tenant's record", async () => {
    const foreignAudit = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgB.id } });
    expect(find((await searchWorkspace(as(orgA.id), foreignAudit.entityId)).groups, "audit").map((r) => r.id)).not.toContain(foreignAudit.id);
  });
});

describe("authorization: a role only searches what it may view", () => {
  const ROLES: Record<MemberRole, { incident: boolean; alert: boolean; audit: boolean }> = {
    OWNER: { incident: true, alert: true, audit: true },
    ADMIN: { incident: true, alert: true, audit: true },
    SECURITY: { incident: true, alert: true, audit: true },
    ENGINEER: { incident: true, alert: true, audit: true },
    VIEWER: { incident: true, alert: true, audit: true },
    FINANCE: { incident: false, alert: false, audit: true },
  };

  it.each(Object.entries(ROLES))("%s", async (role, expected) => {
    const { groups } = await searchWorkspace(as(orgA.id, role as MemberRole), TOKEN);
    expect(types(groups).includes("incident")).toBe(expected.incident);
    expect(types(groups).includes("alert")).toBe(expected.alert);
    expect(types(groups).includes("audit")).toBe(expected.audit);
    // Everyone can search the entities every member can already browse.
    for (const t of ["agent", "policy", "approval", "event"]) expect(types(groups)).toContain(t);
  });

  it("a role without security access learns nothing about incidents: not even a count or an empty group", async () => {
    const { groups } = await searchWorkspace(as(orgA.id, "FINANCE"), "INC-4242");
    expect(JSON.stringify(groups)).not.toContain("incident");
    expect(JSON.stringify(groups)).not.toContain(ids.incident);
  });
});

describe("bounded", () => {
  it(`returns at most ${SEARCH_PER_TYPE} results per type even when many match`, async () => {
    const org = await prisma.organization.create({ data: { name: "Many", slug: `${RUN_ID}-many`, plan: "enterprise" } });
    try {
      await prisma.agent.createMany({
        data: Array.from({ length: 14 }, (_, i) => ({ organizationId: org.id, name: `${TOKEN}-bulk-${i}`, slug: `${TOKEN}-bulk-${i}`, owner: "Ops", modelProvider: "x", modelName: "y" })),
      });
      const { groups } = await searchWorkspace(as(org.id), `${TOKEN}-bulk`);
      expect(find(groups, "agent")).toHaveLength(SEARCH_PER_TYPE);
    } finally {
      await prisma.agent.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("only searches recent activity (the last 30 days)", async () => {
    const old = await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: ids.agent, eventType: "ACTION", action: `${TOKEN}.ancient`, timestamp: new Date(Date.now() - 40 * 86_400_000) },
    });
    expect(find((await searchWorkspace(as(orgA.id), `${TOKEN}.ancient`)).groups, "event").map((r) => r.id)).not.toContain(old.id);
  });
});
