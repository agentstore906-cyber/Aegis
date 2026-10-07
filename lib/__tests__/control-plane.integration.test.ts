/**
 * Control plane — inventory, posture, enforcement coverage, identity assurance,
 * the per-agent control view, lifecycle auditing, kill-switch separation of
 * duties, and the admin API's authorization, against the verified disposable
 * test database through the real routes and services.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Agent, MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { ADMIN_API_KEY_SCOPES, AdminScopeOnBoundKeyError, DEFAULT_API_KEY_SCOPES } from "@/lib/api-keys/scopes";
import { AgentResumeForbiddenError, AgentStatusConflictError, setAgentControlState } from "@/lib/agents/control";
import { canResumeStoppedAgent } from "@/lib/agents/authorization";
import { upsertAlertFinding } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { drainDeferredTasks } from "@/lib/server/defer";
import { getEnforcementCoverage } from "@/lib/control/coverage";
import { getIdentityBindings } from "@/lib/control/identity";
import { getInventory, getInventoryAgent } from "@/lib/control/inventory";
import { getAgentControlView } from "@/lib/control/agent-view";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";
import { POST as registerHandler } from "@/app/api/v1/agents/register/route";
import { POST as simulateHandler } from "@/app/api/v1/simulate/route";
import { GET as inventoryHandler } from "@/app/api/v1/agents/route";
import { CALM, DAY, HIGH_REQ, giveBaseline, giveTrust, makeAgent, nextSeq } from "@/lib/control/__tests__/fixtures";

const RUN_ID = `test_cp_${Date.now()}`;
const ctx = { params: Promise.resolve<Record<string, string>>({}) };

let orgC: { id: string; name: string };
let orgD: { id: string };
let user: { id: string };
let orgWideKey: string;
let adminKey: string;
let defaultKeyC: string;
let keyD: string;
let adminKeyD: string;

async function call(handler: (r: Request, c: typeof ctx) => Promise<Response>, url: string, key: string | null, init: { method?: string; body?: unknown } = {}) {
  const response = await handler(
    new Request(url, {
      method: init.method ?? "POST",
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    ctx
  );
  const text = await response.text();
  await drainDeferredTasks();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, body, text };
}
const report = (agent: Agent, body: Record<string, unknown>, key = orgWideKey) => call(eventsHandler, "http://localhost/api/v1/events", key, { body: { agent: agent.slug, eventType: "TOOL_CALL", status: "SUCCESS", ...body } });
const decide = (agent: Agent, body: Record<string, unknown>, key = orgWideKey) => call(evaluateHandler, "http://localhost/api/v1/evaluate", key, { body: { agent: agent.slug, ...body } });

beforeAll(async () => {
  orgC = await prisma.organization.create({ data: { name: "CP Org C", slug: `${RUN_ID}-c`, plan: "enterprise" } });
  orgD = await prisma.organization.create({ data: { name: "CP Org D", slug: `${RUN_ID}-d`, plan: "enterprise" } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Pat Operator" } });
  orgWideKey = (await createApiKey(orgC.id, null, { name: "shared", environment: "TEST" })).raw;
  defaultKeyC = (await createApiKey(orgC.id, null, { name: "default", environment: "TEST" })).raw;
  adminKey = (await createApiKey(orgC.id, null, { name: "tooling", environment: "TEST", adminAccess: true })).raw;
  keyD = (await createApiKey(orgD.id, null, { name: "d", environment: "TEST" })).raw;
  adminKeyD = (await createApiKey(orgD.id, null, { name: "d-admin", environment: "TEST", adminAccess: true })).raw;
}, 60_000);

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgC.id, orgD.id];
  await prisma.incidentActivity.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.incident.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

// ---------------------------------------------------------------------------

describe("scopes", () => {
  it("the agent-facing default scopes in code equal the database default (they cannot drift)", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const match = schema.match(/scopes\s+String\[\]\s+@default\(\[([^\]]*)\]\)/);
    expect(match).not.toBeNull();
    const fromSchema = match![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect([...DEFAULT_API_KEY_SCOPES]).toEqual(fromSchema);
    // Admin scopes are NOT defaults.
    for (const scope of ADMIN_API_KEY_SCOPES) expect(fromSchema).not.toContain(scope);
  });

  it("an ordinary key gets only the default scopes; admin access adds exactly the opt-in ones", async () => {
    const plain = await prisma.apiKey.findFirstOrThrow({ where: { organizationId: orgC.id, name: "default" } });
    expect(plain.scopes).toEqual([...DEFAULT_API_KEY_SCOPES]);
    const admin = await prisma.apiKey.findFirstOrThrow({ where: { organizationId: orgC.id, name: "tooling" } });
    expect(admin.scopes).toEqual([...DEFAULT_API_KEY_SCOPES, ...ADMIN_API_KEY_SCOPES]);
  });

  it("admin access can never be granted to a key bound to one agent", async () => {
    const agent = await makeAgent(orgC.id);
    await expect(createApiKey(orgC.id, null, { name: "bad", environment: "TEST", agentId: agent.id, adminAccess: true })).rejects.toBeInstanceOf(AdminScopeOnBoundKeyError);
    expect(await prisma.apiKey.count({ where: { organizationId: orgC.id, name: "bad" } })).toBe(0);
  });
});

describe("agent registration is audited (lifecycle: created)", () => {
  it("a new agent gets an agent.created audit event naming the key; a repeat registration adds none", async () => {
    const name = `registered-${nextSeq()}`;
    const first = await call(registerHandler, "http://localhost/api/v1/agents/register", orgWideKey, { body: { name } });
    expect(first.status).toBe(201);
    const agentId = first.body.id as string;
    const key = await prisma.apiKey.findFirstOrThrow({ where: { organizationId: orgC.id, name: "shared" } });
    const events = await prisma.auditEvent.findMany({ where: { organizationId: orgC.id, entityId: agentId, eventType: "agent.created" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId, actorType: "SYSTEM", action: "agent.register" });
    expect(events[0].metadata).toMatchObject({ via: "api_register", keyId: key.id });
    expect(JSON.stringify(events[0].metadata)).not.toContain(orgWideKey); // never the secret

    const again = await call(registerHandler, "http://localhost/api/v1/agents/register", orgWideKey, { body: { name } });
    expect(again.status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgC.id, entityId: agentId, eventType: "agent.created" } })).toBe(1);
  });

  it("concurrent registrations of the same new agent record exactly one creation", async () => {
    const name = `race-${nextSeqName()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => call(registerHandler, "http://localhost/api/v1/agents/register", orgWideKey, { body: { name } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]); // one creator, four readers of its result
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const id = results[0].body.id as string;
    expect(typeof id).toBe("string");
    expect(await prisma.auditEvent.count({ where: { organizationId: orgC.id, entityId: id, eventType: "agent.created" } })).toBe(1);
  });
});
function nextSeqName() {
  return `${RUN_ID}-${nextSeq()}`;
}

describe("enforcement coverage — evidence of whether Aegis is in the loop", () => {
  it("counts decided vs undecided reported actions, ignores system chatter, and flags execution despite a refusal", async () => {
    const agent = await makeAgent(orgC.id);
    // Decided, allowed execution.
    const ok = await decide(agent, { action: "crm.read", tool: "CRM", ...flat(CALM) });
    await report(agent, { action: "crm.read", tool: "CRM", evaluationId: ok.body.evaluationId, ...flat(CALM) });
    // Two actions that never asked Aegis.
    await report(agent, { action: "crm.read", tool: "CRM" });
    await report(agent, { action: "crm.export", tool: "CRM", eventType: "DATA_ACCESS" });
    // System chatter and model calls are not "actions with effects".
    await report(agent, { action: "agent.started", eventType: "SYSTEM" });
    await report(agent, { action: "llm.call", eventType: "MODEL_CALL" });
    // A refusal the agent ran anyway.
    const refused = await decide(agent, { action: "unlisted.action" });
    expect(refused.body.decision).toBe("BLOCK");
    await report(agent, { action: "unlisted.action", evaluationId: refused.body.evaluationId });
    // ... and a refusal it respected.
    const respected = await decide(agent, { action: "unlisted.other" });
    await report(agent, { action: "unlisted.other", evaluationId: respected.body.evaluationId, status: "BLOCKED" });

    const c = (await getEnforcementCoverage(orgC.id, [agent.id])).get(agent.id)!;
    expect(c).toMatchObject({ reportedActions: 5, decided: 3, undecided: 2, ranDespite: 1, decisionRequests: 3, windowDays: 7 });
    expect(c.coverage).toBeCloseTo(3 / 5);
  });

  it("no reported actions means no evidence: coverage is null, never 0% or 100%", async () => {
    const agent = await makeAgent(orgC.id);
    expect((await getEnforcementCoverage(orgC.id, [agent.id])).get(agent.id)).toMatchObject({ reportedActions: 0, coverage: null, ranDespite: 0 });
    await decide(agent, { action: "crm.read", ...flat(CALM) }); // asks, but reports nothing
    expect((await getEnforcementCoverage(orgC.id, [agent.id])).get(agent.id)).toMatchObject({ reportedActions: 0, decisionRequests: 1, coverage: null });
  });

  it("only counts the window, and only this tenant's rows", async () => {
    const agent = await makeAgent(orgC.id);
    await prisma.activityEvent.create({ data: { organizationId: orgC.id, agentId: agent.id, eventType: "ACTION", action: "old.action", source: "api", timestamp: new Date(Date.now() - 10 * DAY) } });
    expect((await getEnforcementCoverage(orgC.id, [agent.id], { days: 7 })).get(agent.id)!.reportedActions).toBe(0);
    expect((await getEnforcementCoverage(orgC.id, [agent.id], { days: 30 })).get(agent.id)!.reportedActions).toBe(1);
    // Another tenant's agent id passed under our organization sees nothing.
    const foreign = await makeAgent(orgD.id);
    await prisma.activityEvent.create({ data: { organizationId: orgD.id, agentId: foreign.id, eventType: "ACTION", action: "d.action", source: "api" } });
    expect((await getEnforcementCoverage(orgC.id, [foreign.id])).get(foreign.id)).toMatchObject({ reportedActions: 0, coverage: null });
  });

  it("an evaluation id that points at another tenant's decision is not counted as 'ran despite'", async () => {
    const mine = await makeAgent(orgC.id);
    const theirs = await makeAgent(orgD.id);
    const theirBlock = await decide(theirs, { action: "unlisted.action" }, keyD);
    expect(theirBlock.body.decision).toBe("BLOCK");
    await prisma.activityEvent.create({ data: { organizationId: orgC.id, agentId: mine.id, eventType: "ACTION", action: "x.action", source: "api", outcome: "SUCCESS", evaluationId: theirBlock.body.evaluationId as string } });
    expect((await getEnforcementCoverage(orgC.id, [mine.id])).get(mine.id)!.ranDespite).toBe(0);
  });
});

function flat(t: { telemetry: { service?: string; destination?: { destination: string }; dataClasses?: string[]; recordCount?: number } }) {
  return { service: t.telemetry.service, destination: t.telemetry.destination?.destination, dataClasses: t.telemetry.dataClasses, recordCount: t.telemetry.recordCount };
}

describe("identity assurance — how impersonable is each agent?", () => {
  it("follows the keys that exist, and revoked or expired keys do not count", async () => {
    const isolated = await prisma.organization.create({ data: { name: "Iso", slug: `${RUN_ID}-iso` } });
    try {
      const agent = await makeAgent(isolated.id);
      const other = await makeAgent(isolated.id);
      const get = async () => (await getIdentityBindings(isolated.id, [agent.id, other.id])).get(agent.id)!;
      expect(await get()).toMatchObject({ assurance: "NO_KEY", boundKeys: 0, orgWideKeys: 0 });

      const bound = await createApiKey(isolated.id, null, { name: "bound", environment: "TEST", agentId: agent.id });
      expect(await get()).toMatchObject({ assurance: "ISOLATED", boundKeys: 1 });
      expect((await getIdentityBindings(isolated.id, [other.id])).get(other.id)!.assurance).toBe("NO_KEY");

      const shared = await createApiKey(isolated.id, null, { name: "shared", environment: "TEST" });
      expect(await get()).toMatchObject({ assurance: "BOUND_SHARED", orgWideKeys: 1 });
      expect((await getIdentityBindings(isolated.id, [other.id])).get(other.id)!.assurance).toBe("ORG_WIDE_ONLY");

      await prisma.apiKey.update({ where: { id: shared.apiKey.id }, data: { revokedAt: new Date() } });
      expect(await get()).toMatchObject({ assurance: "ISOLATED", orgWideKeys: 0 });

      await prisma.apiKey.update({ where: { id: bound.apiKey.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await get()).toMatchObject({ assurance: "NO_KEY", boundKeys: 0 });
    } finally {
      await prisma.apiKey.deleteMany({ where: { organizationId: isolated.id } });
      await prisma.agent.deleteMany({ where: { organizationId: isolated.id } });
      await prisma.organization.delete({ where: { id: isolated.id } });
    }
  });

  it("another tenant's keys never count toward this tenant's assurance", async () => {
    const agent = await makeAgent(orgC.id);
    const bindings = await getIdentityBindings(orgC.id, [agent.id]);
    const own = await prisma.apiKey.count({ where: { organizationId: orgC.id, agentId: null, revokedAt: null } });
    expect(bindings.get(agent.id)!.orgWideKeys).toBe(own);
  });
});

describe("organization-wide inventory", () => {
  const A: Record<string, Agent> = {};
  let inv: Awaited<ReturnType<typeof getInventory>>;
  const bySlug = (slug: string) => inv.agents.find((a) => a.slug === slug)!;

  beforeAll(async () => {
    // A dedicated organization so every count is exact.
    const org = await prisma.organization.create({ data: { name: "Inventory Org", slug: `${RUN_ID}-inv`, plan: "enterprise" } });
    (globalThis as { __invOrg?: string }).__invOrg = org.id;
    const key = (await createApiKey(org.id, null, { name: "shared", environment: "TEST" })).raw;
    const mk = async (slug: string, options: Parameters<typeof makeAgent>[1] = {}) => (A[slug] = await makeAgent(org.id, { slug, ...options }));
    const rep = (agent: Agent, body: Record<string, unknown>) => report(agent, body, key);
    const dec = (agent: Agent, body: Record<string, unknown>) => decide(agent, body, key);

    await mk("protected-one", { owner: "Platform", baseline: true, trust: "TRUSTED" });
    // The calm agent has its own bound key and behaves exactly like its baseline (ACTION events, usual tool/destination/data).
    const ownKey = (await createApiKey(org.id, null, { name: "protected-one key", environment: "TEST", agentId: A["protected-one"].id })).raw;
    const ok = await decide(A["protected-one"], { action: "crm.read", tool: "CRM", ...flat(CALM) }, ownKey);
    await report(A["protected-one"], { action: "crm.read", tool: "CRM", eventType: "ACTION", evaluationId: ok.body.evaluationId, ...flat(CALM) }, ownKey);

    await mk("observed-one", { owner: "Platform" });
    await rep(A["observed-one"], { action: "crm.read" });

    await mk("discovered-one", { owner: "Platform", permissions: [] });
    await mk("stopped-one", { owner: "Platform" });
    await setAgentControlState(org.id, "stopped-one", "STOPPED", user.id, "incident drill");
    await mk("unowned-one", { owner: "API" });
    await mk("broad-one", { owner: "Platform", permissions: [{ action: "crm.*", decision: "ALLOW" }] });
    await mk("incident-one", { owner: "Platform" });
    await upsertAlertFinding(org.id, { type: SECURITY_ALERT_TYPES.BLOCK_SPIKE, severity: "HIGH", agentId: A["incident-one"].id, title: "Spike", description: "d", evidence: {}, traceId: "trace-inv-1" });
    await mk("approval-one", { owner: "Platform" });
    const gated = await dec(A["approval-one"], { action: "refund.issue" });
    expect(gated.body.decision).toBe("REQUIRE_APPROVAL");
    await mk("degraded-one", { owner: "Platform", trust: "DEGRADED", environment: "STAGING" });
    await mk("unusual-one", { owner: "Platform", baseline: true });
    await prisma.behavioralDeviation.create({
      data: { organizationId: org.id, agentId: A["unusual-one"].id, kind: "NEW_DESTINATION", dedupeKey: "destination:x", day: new Date(), baselineVersion: 1, maturity: "ESTABLISHED", confidence: "HIGH", observed: {}, expected: {}, explanation: "x" },
    });
    await mk("despite-one", { owner: "Platform" });
    const refused = await dec(A["despite-one"], { action: "unlisted.action" });
    await rep(A["despite-one"], { action: "unlisted.action", evaluationId: refused.body.evaluationId });
    await mk("risky-config", { owner: "Platform", environment: "DEVELOPMENT" });
    await prisma.agent.update({ where: { id: A["risky-config"].id }, data: { riskLevel: "CRITICAL" } });
    await mk("archived-one", { owner: "Platform" });
    await prisma.agent.update({ where: { id: A["archived-one"].id }, data: { status: "ARCHIVED" } });
    await drainDeferredTasks();

    inv = await getInventory(org.id, { pageSize: 200 });
  }, 120_000);

  afterAll(async () => {
    const id = (globalThis as { __invOrg?: string }).__invOrg;
    if (!id) return;
    await prisma.incidentActivity.deleteMany({ where: { organizationId: id } });
    await prisma.incident.deleteMany({ where: { organizationId: id } });
    await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: id } });
    await prisma.securityAlert.deleteMany({ where: { organizationId: id } });
    await prisma.approvalRequest.deleteMany({ where: { organizationId: id } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: id } });
    await prisma.idempotencyRecord.deleteMany({ where: { organizationId: id } });
    await prisma.behavioralDeviation.deleteMany({ where: { organizationId: id } });
    await prisma.policyEvaluation.deleteMany({ where: { organizationId: id } });
    await prisma.activityEvent.deleteMany({ where: { organizationId: id } });
    await prisma.apiKey.deleteMany({ where: { organizationId: id } });
    await prisma.agent.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  });

  it("derives each agent's posture from evidence, never from a stored label", () => {
    expect(bySlug("protected-one").posture).toBe("PROTECTED");
    expect(bySlug("observed-one").posture).toBe("OBSERVED");
    expect(bySlug("discovered-one").posture).toBe("DISCOVERED");
    expect(bySlug("stopped-one").posture).toBe("STOPPED");
    expect(bySlug("archived-one").posture).toBe("RETIRED");
    expect(bySlug("unowned-one").posture).toBe("QUIET");
    expect(bySlug("protected-one").adoption).toBe("PROTECTED");
    expect(bySlug("observed-one").adoption).toBe("OBSERVING");
    expect(bySlug("unowned-one").adoption).toBe("CONNECTED");
  });

  it("raises each attention flag from the rows that justify it, and only then", () => {
    // The calm agent is owned, behaves like its baseline, has its own key, and ran under its decision. (Real detectors may
    // legitimately open an incident for a fresh agent, so only the flags this evidence must NOT raise are asserted.)
    for (const flag of ["NO_OWNER", "UNUSUAL_BEHAVIOR", "TRUST_DEGRADED", "RAN_DESPITE_DECISION", "SHARED_IDENTITY", "BROAD_GRANT"] as const) {
      expect(bySlug("protected-one").attention, flag).not.toContain(flag);
    }
    expect(bySlug("unowned-one").attention).toEqual(["NO_OWNER"]);
    expect(bySlug("broad-one").attention).toEqual(["BROAD_GRANT"]);
    expect(bySlug("incident-one").attention).toContain("OPEN_INCIDENT");
    expect(bySlug("approval-one").attention).toContain("PENDING_APPROVAL");
    expect(bySlug("degraded-one").attention).toEqual(["TRUST_DEGRADED"]);
    expect(bySlug("unusual-one").attention).toContain("UNUSUAL_BEHAVIOR");
    expect(bySlug("despite-one").attention).toContain("RAN_DESPITE_DECISION");
    // An owner-configured risk level is configuration, not evidence: it raises no attention flag, and the flag no longer exists.
    expect(bySlug("risky-config").attention).not.toContain("HIGH_RISK");
    // The two org-wide-key agents that report activity are flagged as shared-key identities; ones with no activity are not.
    expect(bySlug("observed-one").attention).toContain("SHARED_IDENTITY");
    expect(bySlug("unowned-one").attention).not.toContain("SHARED_IDENTITY");
  });

  it("reports access, trust, approvals, incidents and coverage per agent", () => {
    const p = bySlug("protected-one");
    expect(p.access).toMatchObject({ allow: 2, requireApproval: 1, block: 0, total: 3, broadGrants: 0 });
    expect(p.trust).toMatchObject({ state: "TRUSTED" });
    expect(p.baselineMaturity).toBe("ESTABLISHED");
    expect(p.coverage).toMatchObject({ reportedActions: 1, decided: 1, coverage: 1, ranDespite: 0 });
    expect(bySlug("broad-one").access.broadGrants).toBe(1);
    expect(bySlug("approval-one")).toMatchObject({ pendingApprovals: 1 });
    expect(bySlug("approval-one").decisions7d.REQUIRE_APPROVAL).toBe(1);
    expect(bySlug("incident-one").openIncidents).toBe(1);
    expect(bySlug("despite-one").coverage).toMatchObject({ reportedActions: 1, decided: 1, ranDespite: 1 });
    expect(bySlug("discovered-one").access.total).toBe(0);
  });

  it("answers the organization-level questions with counts of real rows", async () => {
    const s = inv.summary;
    expect(s.total).toBe(13);
    expect(s.byStatus).toMatchObject({ ACTIVE: 11, STOPPED: 1, ARCHIVED: 1 });
    expect(s.byEnvironment).toMatchObject({ PRODUCTION: 11, STAGING: 1, DEVELOPMENT: 1 });
    expect(s.unowned).toBe(1);
    expect(s.owners).toBe(1); // everyone else is owned by "Platform"
    expect(s.nothingGranted).toBe(1);
    expect(s.stoppedOrPaused).toBe(1);
    expect(s.ranDespiteDecision).toBe(1);
    expect(s.observeOnly).toBe(1);
    expect(s.sharedKeyIdentity).toBeGreaterThanOrEqual(2);

    // Every other tile equals an independent count of the underlying rows — "a count of stored rows", verified.
    const id = (globalThis as { __invOrg?: string }).__invOrg!;
    const since = new Date(Date.now() - 7 * DAY);
    const distinct = (rows: { agentId: string }[]) => new Set(rows.map((r) => r.agentId)).size;
    const [pending, incidents, deviations] = await Promise.all([

      prisma.approvalRequest.findMany({ where: { organizationId: id, status: "PENDING" }, select: { agentId: true } }),
      prisma.incident.findMany({ where: { organizationId: id, status: { in: ["OPEN", "INVESTIGATING"] } }, select: { agentId: true } }),
      prisma.behavioralDeviation.findMany({ where: { organizationId: id, lastSeenAt: { gte: since } }, select: { agentId: true } }),
    ]);
    expect(s.needingApproval).toBe(distinct(pending));
    expect(s.withOpenIncidents).toBe(distinct(incidents));
    expect(s.withOpenIncidents).toBeGreaterThanOrEqual(1); // at least the explicit alert
    expect(s.unusualBehavior).toBe(distinct(deviations));
    expect(s.unusualBehavior).toBeGreaterThanOrEqual(1);
    expect("highRisk" in s).toBe(false); // no derived high-risk tile
    expect(s.byPosture.PROTECTED).toBeGreaterThanOrEqual(1);
    expect(inv.truncated).toBe(false);
  });

  it("filters by environment, lifecycle, posture, flag and text, and pages deterministically", async () => {
    const id = (globalThis as { __invOrg?: string }).__invOrg!;
    expect((await getInventory(id, { environment: "STAGING" })).agents.map((a) => a.slug)).toEqual(["degraded-one"]);
    expect((await getInventory(id, { status: "STOPPED" })).agents.map((a) => a.slug)).toEqual(["stopped-one"]);
    expect((await getInventory(id, { posture: "DISCOVERED" })).agents.map((a) => a.slug)).toEqual(["discovered-one"]);
    expect((await getInventory(id, { flag: "BROAD_GRANT" })).agents.map((a) => a.slug)).toEqual(["broad-one"]);
    expect((await getInventory(id, { q: "DESPITE" })).agents.map((a) => a.slug)).toEqual(["despite-one"]);
    expect((await getInventory(id, { q: "no-such-agent" })).total).toBe(0);
    // Summary is organization-wide even when the list is filtered.
    expect((await getInventory(id, { environment: "STAGING" })).summary.total).toBe(13);

    const seen: string[] = [];
    for (let page = 1; ; page += 1) {
      const result = await getInventory(id, { pageSize: 4, page });
      seen.push(...result.agents.map((a) => a.slug));
      if (page >= result.pageCount) break;
    }
    expect(seen).toHaveLength(13);
    expect(new Set(seen).size).toBe(13);
    expect(seen).toEqual(inv.agents.map((a) => a.slug)); // identical order every time
    // Most attention first.
    const flags = inv.agents.map((a) => a.attention.length);
    expect(flags).toEqual([...flags].sort((x, y) => y - x));
  });

  it("another tenant's agents never appear in, or change, this tenant's inventory", async () => {
    const id = (globalThis as { __invOrg?: string }).__invOrg!;
    const before = await getInventory(id, { pageSize: 200 });
    const foreign = await makeAgent(orgD.id, { slug: "foreign-agent", owner: "Intruder" });
    await prisma.agent.update({ where: { id: foreign.id }, data: { riskLevel: "CRITICAL" } });
    const result = await getInventory(id, { pageSize: 200 });
    expect(result.agents.some((a) => a.slug === "foreign-agent")).toBe(false);
    expect(result.summary).toEqual(before.summary); // another tenant's CRITICAL agent changes nothing here
    expect(await getInventoryAgent(id, "foreign-agent")).toBeNull();
    const own = await getInventory(orgD.id, { pageSize: 200 });
    expect(own.agents.some((a) => a.slug === "foreign-agent")).toBe(true);
    expect(own.agents.some((a) => a.slug === "protected-one")).toBe(false);
  });
});

describe("per-agent control view", () => {
  it("shows lifecycle history from the audit trail with who, why and whether it was enforced", async () => {
    const agent = await makeAgent(orgC.id, { slug: `lifecycle-${nextSeq()}` });
    await setAgentControlState(orgC.id, agent.slug, "PAUSED", user.id, "investigating");
    await setAgentControlState(orgC.id, agent.slug, "ACTIVE", user.id, "all clear");
    await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "incident");
    const view = (await getAgentControlView(orgC.id, agent.slug))!;
    expect(view.lifecycle.map((l) => `${l.event}:${l.from ?? ""}>${l.to ?? ""}`)).toEqual(["stopped:ACTIVE>STOPPED", "resumed:PAUSED>ACTIVE", "paused:ACTIVE>PAUSED"]);
    expect(view.lifecycle[0]).toMatchObject({ actor: "Pat Operator", reason: "incident", enforced: false });
    expect(view.agent.posture).toBe("STOPPED");
  });

  it("reviews least privilege from evidence: broad grants, and grants with no use in 30 days", async () => {
    const agent = await makeAgent(orgC.id, {
      permissions: [
        { action: "crm.*", decision: "ALLOW" },
        { action: "invoice.read", decision: "ALLOW" },
        { action: "refund.issue", decision: "REQUIRE_APPROVAL" },
        { action: "payments.send", decision: "ALLOW" },
        { action: "danger.delete", decision: "BLOCK" },
      ],
    });
    await report(agent, { action: "crm.contact.read" }); // makes crm.* "used"
    await decide(agent, { action: "invoice.read" }); // makes invoice.read "used"
    const view = (await getAgentControlView(orgC.id, agent.slug))!;
    expect(view.review.broadGrants.map((p) => p.action)).toEqual(["crm.*"]);
    expect(view.review.unusedGrants.map((p) => p.action)).toEqual(["payments.send"]); // refund.issue needs approval (not an open grant); danger.delete is a BLOCK
    expect(view.review.observedActions).toBe(2);
    expect(view.review.note).toContain("not that it is safe to remove");
  });

  it("with no activity there is no evidence to review against, and it says so", async () => {
    const agent = await makeAgent(orgC.id);
    const view = (await getAgentControlView(orgC.id, agent.slug))!;
    expect(view.review.observedActions).toBe(0);
    expect(view.review.note).toContain("no evidence to review against");
  });

  it("lists keys by prefix only — never a hash or secret — and the right ones", async () => {
    const agent = await makeAgent(orgC.id);
    const bound = await createApiKey(orgC.id, null, { name: "Agent SDK", environment: "TEST", agentId: agent.id });
    const view = (await getAgentControlView(orgC.id, agent.slug))!;
    expect(view.keys.map((k) => k.name)).toEqual(["Agent SDK"]);
    expect(view.keys[0].prefix).toBe(bound.apiKey.prefix);
    const text = JSON.stringify(view);
    expect(text).not.toContain(bound.raw);
    expect(text).not.toContain(bound.apiKey.keyHash);
    expect(view.agent.identity.assurance).toBe("BOUND_SHARED"); // the org has shared keys
  });

  it("an agent from another organization is not found, and its history never leaks in", async () => {
    const foreign = await makeAgent(orgD.id, { slug: `foreign-view-${nextSeq()}` });
    await setAgentControlState(orgD.id, foreign.slug, "STOPPED", user.id, "secret reason");
    expect(await getAgentControlView(orgC.id, foreign.slug)).toBeNull();
    const own = (await getAgentControlView(orgD.id, foreign.slug))!;
    expect(own.lifecycle[0].reason).toBe("secret reason");
    const mine = await makeAgent(orgC.id);
    expect(JSON.stringify(await getAgentControlView(orgC.id, mine.slug))).not.toContain("secret reason");
  });
});

describe("kill switch: separation of duties and compare-and-set", () => {
  const fresh = async () => makeAgent(orgC.id, { slug: `kill-${nextSeq()}` });

  it("only owners, admins and security responders may resume a STOPPED agent", () => {
    const expected: Record<MemberRole, boolean> = { OWNER: true, ADMIN: true, SECURITY: true, ENGINEER: false, VIEWER: false, FINANCE: false };
    for (const [role, allowed] of Object.entries(expected)) expect(canResumeStoppedAgent(role as MemberRole), role).toBe(allowed);
  });

  it("an engineer can pause, resume a PAUSED agent and stop — but cannot undo a STOP", async () => {
    const agent = await fresh();
    await setAgentControlState(orgC.id, agent.slug, "PAUSED", user.id, "hold", { actorRole: "ENGINEER" });
    await setAgentControlState(orgC.id, agent.slug, "ACTIVE", user.id, "resume", { actorRole: "ENGINEER" });
    await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "shut down", { actorRole: "ENGINEER" });

    for (const target of ["ACTIVE", "PAUSED"] as const) {
      await expect(setAgentControlState(orgC.id, agent.slug, target, user.id, "undo", { actorRole: "ENGINEER" })).rejects.toBeInstanceOf(AgentResumeForbiddenError);
    }
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("STOPPED");
    // Refusals leave no trace in the audit trail of having changed anything.
    expect(await prisma.auditEvent.count({ where: { organizationId: orgC.id, entityId: agent.id, eventType: "agent.resumed" } })).toBe(1);
  });

  it("security responders, admins and owners can resume a STOPPED agent; stopping again is always allowed", async () => {
    for (const role of ["SECURITY", "ADMIN", "OWNER"] as MemberRole[]) {
      const agent = await fresh();
      await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "stop", { actorRole: "ENGINEER" });
      await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "again", { actorRole: "VIEWER" }); // idempotent, never a weakening
      expect(await setAgentControlState(orgC.id, agent.slug, "ACTIVE", user.id, "cleared", { actorRole: role })).toMatchObject({ previousStatus: "STOPPED", newStatus: "ACTIVE" });
    }
  });

  it("internal callers that pass no role are unchanged (the action layer always passes one)", async () => {
    const agent = await fresh();
    await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id);
    await expect(setAgentControlState(orgC.id, agent.slug, "ACTIVE", user.id)).resolves.toMatchObject({ newStatus: "ACTIVE" });
  });

  it("a stop is still absolute: a stopped agent is refused no matter who asks", async () => {
    const agent = await fresh();
    await setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "stop", { actorRole: "SECURITY" });
    const response = await decide(agent, { action: "crm.read" });
    expect(response.body).toMatchObject({ decision: "BLOCK", decisionSource: "CONTROL" });
  });

  it("concurrent conflicting transitions: exactly one wins, the other is told, nothing is overwritten", async () => {
    const agent = await fresh();
    const results = await Promise.allSettled([
      setAgentControlState(orgC.id, agent.slug, "PAUSED", user.id, "a", { actorRole: "SECURITY" }),
      setAgentControlState(orgC.id, agent.slug, "STOPPED", user.id, "b", { actorRole: "SECURITY" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(AgentStatusConflictError);
    const status = (await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).status;
    const transitions = await prisma.auditEvent.findMany({ where: { organizationId: orgC.id, entityId: agent.id, eventType: { in: ["agent.paused", "agent.stopped"] } } });
    expect(transitions).toHaveLength(1);
    expect(["PAUSED", "STOPPED"]).toContain(status);
  });
});

describe("admin API: simulate", () => {
  const body = (agent: Agent, extra: Record<string, unknown> = {}) => ({ agent: agent.slug, action: "crm.export", tool: "CRM", ...flat(CALM), ...extra });

  it("requires the opt-in policy:simulate scope: ordinary keys are refused", async () => {
    const agent = await makeAgent(orgC.id);
    const refused = await call(simulateHandler, "http://localhost/api/v1/simulate", defaultKeyC, { body: body(agent) });
    expect(refused.status).toBe(403);
    expect((refused.body.error as { code: string }).code).toBe("INSUFFICIENT_SCOPE");
    expect((await call(simulateHandler, "http://localhost/api/v1/simulate", null, { body: body(agent) })).status).toBe(401);
  });

  it("answers with the full explanation and writes nothing", async () => {
    const agent = await makeAgent(orgC.id, { baseline: true, trust: "TRUSTED" });
    const where = { organizationId: orgC.id };
    const before = await Promise.all([prisma.policyEvaluation.count({ where }), prisma.activityEvent.count({ where }), prisma.approvalRequest.count({ where }), prisma.auditEvent.count({ where }), prisma.securityAlert.count({ where })]);
    const response = await call(simulateHandler, "http://localhost/api/v1/simulate", adminKey, { body: body(agent, flat(HIGH_REQ)) });
    expect(response.status).toBe(200);
    const sim = response.body.simulation as { recorded: boolean; decision: string; stages: { stage: string }[]; risk: { level: string }; enforcement: { note: string } };
    expect(sim).toMatchObject({ recorded: false, decision: "ALLOW" });
    expect(sim.stages).toHaveLength(8);
    expect(sim.risk.level).toBe("HIGH");
    expect(sim.enforcement.note).toContain("depends on the integration honoring it");
    const after = await Promise.all([prisma.policyEvaluation.count({ where }), prisma.activityEvent.count({ where }), prisma.approvalRequest.count({ where }), prisma.auditEvent.count({ where }), prisma.securityAlert.count({ where })]);
    expect(after).toEqual(before);
  });

  it("refuses approvalRequestId, bad bodies and unknown agents", async () => {
    const agent = await makeAgent(orgC.id);
    expect((await call(simulateHandler, "http://localhost/api/v1/simulate", adminKey, { body: body(agent, { approvalRequestId: "x" }) })).status).toBe(400);
    expect((await call(simulateHandler, "http://localhost/api/v1/simulate", adminKey, { body: { agent: agent.slug } })).status).toBe(400);
    expect((await call(simulateHandler, "http://localhost/api/v1/simulate", adminKey, { body: { agent: "no-such-agent", action: "crm.read" } })).status).toBe(404);
  });

  it("a key bound to one agent is refused even if it somehow held the scope", async () => {
    const agent = await makeAgent(orgC.id);
    const bound = await createApiKey(orgC.id, null, { name: "bound-hacked", environment: "TEST", agentId: agent.id });
    await prisma.apiKey.update({ where: { id: bound.apiKey.id }, data: { scopes: [...DEFAULT_API_KEY_SCOPES, ...ADMIN_API_KEY_SCOPES] } }); // bypassing the repository guard
    const response = await call(simulateHandler, "http://localhost/api/v1/simulate", bound.raw, { body: body(agent) });
    expect(response.status).toBe(403);
    expect((response.body.error as { code: string }).code).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("tenant isolation: another organization's admin key cannot simulate this organization's agents", async () => {
    const agent = await makeAgent(orgC.id);
    const response = await call(simulateHandler, "http://localhost/api/v1/simulate", adminKeyD, { body: body(agent) });
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(agent.id);
  });

  it("never echoes secrets sent in the context", async () => {
    const agent = await makeAgent(orgC.id);
    const response = await call(simulateHandler, "http://localhost/api/v1/simulate", adminKey, { body: body(agent, { context: { api_key: "sk-live-supersecretvalue123", amount: 5 } }) });
    expect(response.text).not.toContain("sk-live-supersecretvalue123");
  });
});

describe("admin API: inventory", () => {
  it("requires the opt-in agents:read scope; ordinary keys are refused", async () => {
    const refused = await call(inventoryHandler, "http://localhost/api/v1/agents", defaultKeyC, { method: "GET" });
    expect(refused.status).toBe(403);
    expect((refused.body.error as { code: string }).code).toBe("INSUFFICIENT_SCOPE");
    expect((await call(inventoryHandler, "http://localhost/api/v1/agents", null, { method: "GET" })).status).toBe(401);
  });

  it("returns this organization's summary and agents, paginated, with no secrets", async () => {
    const response = await call(inventoryHandler, "http://localhost/api/v1/agents?pageSize=5&page=1", adminKey, { method: "GET" });
    expect(response.status).toBe(200);
    const result = response.body as { summary: { total: number }; agents: { slug: string }[]; page: { pageSize: number; total: number } };
    expect(result.agents.length).toBeLessThanOrEqual(5);
    expect(result.page.pageSize).toBe(5);
    expect(result.summary.total).toBe(await prisma.agent.count({ where: { organizationId: orgC.id } }));
    for (const forbidden of ["keyHash", "credentialCiphertext", orgWideKey, adminKey]) expect(response.text).not.toContain(forbidden);
  });

  it("validates filters and paging instead of ignoring them", async () => {
    for (const q of ["status=bogus", "environment=moon", "posture=nope", "flag=x", "pageSize=1000", "pageSize=0", "page=0", "flag=HIGH_RISK"]) {
      expect((await call(inventoryHandler, `http://localhost/api/v1/agents?${q}`, adminKey, { method: "GET" })).status, q).toBe(400);
    }
    expect((await call(inventoryHandler, "http://localhost/api/v1/agents?posture=PROTECTED&flag=TRUST_DEGRADED", adminKey, { method: "GET" })).status).toBe(200);
  });

  it("a key bound to one agent is refused; another organization's admin key sees only its own agents", async () => {
    const agent = await makeAgent(orgC.id);
    const bound = await createApiKey(orgC.id, null, { name: "bound-inv", environment: "TEST", agentId: agent.id });
    await prisma.apiKey.update({ where: { id: bound.apiKey.id }, data: { scopes: [...DEFAULT_API_KEY_SCOPES, ...ADMIN_API_KEY_SCOPES] } });
    expect((await call(inventoryHandler, "http://localhost/api/v1/agents", bound.raw, { method: "GET" })).status).toBe(403);

    const theirs = await call(inventoryHandler, "http://localhost/api/v1/agents?pageSize=100", adminKeyD, { method: "GET" });
    const slugs = (theirs.body.agents as { slug: string }[]).map((a) => a.slug);
    expect(slugs).not.toContain(agent.slug);
    expect(theirs.text).not.toContain(agent.id);
  });
});

describe("derived posture follows the data over time", () => {
  it("an agent moves DISCOVERED → QUIET → OBSERVED → PROTECTED as permissions, activity and decisions appear", async () => {
    const agent = await makeAgent(orgC.id, { permissions: [] });
    const posture = async () => (await getInventoryAgent(orgC.id, agent.slug))!.posture;
    expect(await posture()).toBe("DISCOVERED");
    await prisma.agentPermission.create({ data: { organizationId: orgC.id, agentId: agent.id, action: "crm.read", resource: "", decision: "ALLOW" } });
    expect(await posture()).toBe("QUIET");
    await report(agent, { action: "crm.read" });
    expect(await posture()).toBe("OBSERVED");
    await decide(agent, { action: "crm.read" });
    expect(await posture()).toBe("PROTECTED");
    await setAgentControlState(orgC.id, agent.slug, "PAUSED", user.id);
    expect(await posture()).toBe("PAUSED"); // operator state wins
    await giveBaseline(agent).catch(() => undefined);
    await giveTrust(agent, "TRUSTED").catch(() => undefined);
  });
});
