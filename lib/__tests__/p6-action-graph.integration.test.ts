/**
 * P6 — agent action graph, end to end against the verified disposable test
 * database: graph construction from real ingested lineage (decision →
 * execution → follow-on, late-linked parents), ordering, missing parents,
 * large runs with pagination, tenant isolation (including rows that should be
 * impossible), the public API's authorization, and the "observable metadata
 * only" rule.
 *
 * Evidence tables are append-only: rows are created with the desired values,
 * never updated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent, MemberRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { getRunGraph, listRuns, GRAPH_LIMITS } from "@/lib/graph/queries";
import { canViewActionGraph } from "@/lib/graph/authorization";
import type { TimelineItem } from "@/lib/graph/types";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";
import { GET as runsGet } from "@/app/api/v1/agents/[slug]/graph/runs/route";
import { GET as runGet } from "@/app/api/v1/agents/[slug]/graph/runs/[traceId]/route";

const RUN_ID = `test_p6_${Date.now()}`;
const DAY = 86_400_000;

let orgA: { id: string };
let orgB: { id: string };
let agentA: Agent;
let agentA2: Agent;
let agentB: Agent;
let keyA: string;
let keyB: string;
let keyNoScope: string;
let keyBoundToA2: string;

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const asRef = (a: Agent) => ({ id: a.id, name: a.name, slug: a.slug });
const flat = (items: TimelineItem[]): TimelineItem[] => items.flatMap((i) => [i, ...flat(i.children)]);

async function makeAgent(organizationId: string, slug: string) {
  const agent = await prisma.agent.create({
    data: { organizationId, name: `Agent ${slug}`, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m" },
  });
  await prisma.agentPermission.createMany({
    data: ["crm.export", "crm.read", "refund.issue"].map((action) => ({
      organizationId,
      agentId: agent.id,
      action,
      resource: "",
      decision: action === "refund.issue" ? ("REQUIRE_APPROVAL" as const) : ("ALLOW" as const),
    })),
  });
  return agent;
}

async function post(handler: typeof eventsHandler, url: string, key: string, body: Record<string, unknown>) {
  const response = await handler(
    new Request(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    ctx
  );
  const json = (await response.json()) as Record<string, unknown>;
  await drainDeferredTasks();
  return { status: response.status, ...json } as { status: number; id: string; decision: string; evaluationId: string; approvalRequestId?: string; error?: unknown };
}
const report = (agent: Agent, body: Record<string, unknown>, key = keyA) =>
  post(eventsHandler, "http://localhost/api/v1/events", key, { agent: agent.slug, eventType: "TOOL_CALL", status: "SUCCESS", ...body });
const decide = (agent: Agent, body: Record<string, unknown>, key = keyA) =>
  post(evaluateHandler, "http://localhost/api/v1/evaluate", key, { agent: agent.slug, ...body });

function graphGet(key: string | null, slug: string, traceId?: string, query = "") {
  const url = `http://localhost/api/v1/agents/${slug}/graph/runs${traceId ? `/${encodeURIComponent(traceId)}` : ""}${query}`;
  const headers = key ? { authorization: `Bearer ${key}` } : undefined;
  return traceId
    ? runGet(new Request(url, { headers }), { params: Promise.resolve({ slug, traceId }) })
    : runsGet(new Request(url, { headers }), { params: Promise.resolve({ slug }) });
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P6 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P6 B", slug: `${RUN_ID}-b` } });
  agentA = await makeAgent(orgA.id, "p6-a");
  agentA2 = await makeAgent(orgA.id, "p6-a2");
  agentB = await makeAgent(orgB.id, "p6-b");
  keyA = (await createApiKey(orgA.id, null, { name: "a", environment: "TEST" })).raw;
  keyB = (await createApiKey(orgB.id, null, { name: "b", environment: "TEST" })).raw;
  const noScope = await createApiKey(orgA.id, null, { name: "no-graph", environment: "TEST" });
  await prisma.apiKey.update({ where: { id: noScope.apiKey.id }, data: { scopes: ["events:write", "policy:evaluate", "approvals:read"] } });
  keyNoScope = noScope.raw;
  keyBoundToA2 = (await createApiKey(orgA.id, null, { name: "bound", environment: "TEST", agentId: agentA2.id })).raw;
}, 60_000);

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
}, 60_000);

// ---------------------------------------------------------------------------

describe("graph construction from real lineage", () => {
  const TRACE = `${RUN_ID}-main`;

  it("connects decision → execution → follow-on, with entities, decision details and outcomes", async () => {
    const d = await decide(agentA, {
      action: "crm.export",
      tool: "CRM",
      traceId: TRACE,
      service: "crm-api",
      destination: "api.crm.example.com",
      dataClasses: ["PII"],
      recordCount: 12,
      endUserId: "customer-42",
    });
    expect(d.decision).toBe("ALLOW");
    const decisionEvent = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: d.evaluationId } });

    // The execution reported under that decision defaults its parent to the decision event (P1).
    const exec = await report(agentA, { action: "crm.export", tool: "CRM", traceId: TRACE, evaluationId: d.evaluationId, service: "crm-api", destination: "api.crm.example.com", dataClasses: ["PII"], taskId: "task-1", taskType: "export", metadata: { amount: 5 } });
    const follow = await report(agentA, { action: "email.send", eventType: "COMMUNICATION", tool: "Mailer", traceId: TRACE, parentEventId: exec.id, destination: "mail.example.com" });
    expect(exec.status).toBeLessThan(300);
    expect(follow.status).toBeLessThan(300);

    const run = (await getRunGraph(orgA.id, asRef(agentA), TRACE))!;
    expect(run.stats.events).toBe(3);
    expect(run.graph.timeline).toHaveLength(1);
    const root = run.graph.timeline[0];
    expect(root.event.action).toBe("crm.export");
    expect(root.event.source).toBe("policy_evaluation");
    expect(root.event.decision).toMatchObject({ evaluationId: decisionEvent.id, decision: "ALLOW", decisionSource: "POLICY" });
    expect(root.event.decision!.permission).toMatchObject({ action: "crm.export", decision: "ALLOW" });
    expect(root.event.decision!.riskControlOutcome).toBe("OBSERVED");
    expect(root.children.map((c) => c.id)).toEqual([exec.id]);
    expect(root.children[0].event.ranUnder).toMatchObject({ evaluationId: d.evaluationId, decision: "ALLOW" });
    expect(root.children[0].children.map((c) => c.id)).toEqual([follow.id]);
    expect(root.children[0].children[0].depth).toBe(2);

    const kinds = new Set(run.graph.nodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(["USER", "AGENT", "TASK", "TOOL", "API", "DATA", "ACTION", "RESULT"]));
    expect(run.graph.nodes.filter((n) => n.kind === "ACTION")).toHaveLength(3);
    expect(run.graph.edges.filter((e) => e.kind === "CAUSED")).toHaveLength(2);
    expect(run.stats).toMatchObject({ endUsers: 1, taskIds: ["task-1"], decisions: { ALLOW: 1 } });
    expect(run.stats.tools.map((t) => t.key).sort()).toEqual(["crm", "mailer"]);
    expect(run.stats.destinations.map((t) => t.key).sort()).toEqual(["api.crm.example.com", "mail.example.com"]);
    expect(run.stats.dataClasses).toEqual([{ key: "PII", count: 2 }]);
    // The end user is only ever the pseudonym — never the raw id.
    expect(JSON.stringify(run.graph)).not.toContain("customer-42");
  });

  it("orders by receipt time and keeps a parent that arrived after its child (late link)", async () => {
    const trace = `${RUN_ID}-late`;
    const child = await report(agentA, { action: "step.two", traceId: trace, parentClientEventId: "late-parent-1", clientEventId: "late-child-1" });
    const before = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(before.graph.timeline[0].parent.status).toBe("awaiting_parent");
    expect(before.graph.timeline[0].parent.parentClientEventId).toBe("late-parent-1");

    const parent = await report(agentA, { action: "step.one", traceId: trace, clientEventId: "late-parent-1" });
    const after = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(after.graph.counts).toEqual({ events: 2, roots: 1, orphans: 0 });
    expect(after.graph.timeline[0].id).toBe(parent.id);
    expect(after.graph.timeline[0].children.map((c) => c.id)).toEqual([child.id]);
    expect(after.graph.timeline[0].children[0].parent.status).toBe("linked");
  });

  it("sorts siblings in the order Aegis received them", async () => {
    const trace = `${RUN_ID}-order`;
    const root = await report(agentA, { action: "plan", traceId: trace });
    const ids: string[] = [];
    for (const name of ["a", "b", "c", "d"]) ids.push((await report(agentA, { action: `step.${name}`, traceId: trace, parentEventId: root.id })).id);
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(run.graph.timeline[0].children.map((c) => c.id)).toEqual(ids);
    const times = flat(run.graph.timeline).map((i) => i.event.timestamp.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
});

describe("decisions, approvals and blocked actions", () => {
  it("shows a blocked decision, an execution reported despite it (as an observed fact), and a pending approval", async () => {
    const trace = `${RUN_ID}-blocked`;
    const blocked = await decide(agentA, { action: "unlisted.action", traceId: trace });
    expect(blocked.decision).toBe("BLOCK");
    const exec = await report(agentA, { action: "unlisted.action", traceId: trace, evaluationId: blocked.evaluationId, status: "SUCCESS" });
    const gated = await decide(agentA, { action: "refund.issue", traceId: trace });
    expect(gated.decision).toBe("REQUIRE_APPROVAL");

    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    const items = flat(run.graph.timeline);
    const blockedItem = items.find((i) => i.event.decision?.evaluationId === blocked.evaluationId)!;
    expect(blockedItem.flags).toContain("blocked");
    expect(blockedItem.event.decision).toMatchObject({ decision: "BLOCK", decisionSource: "DEFAULT_DENY" });
    expect(blockedItem.event.status).toBe("BLOCKED");

    const execItem = items.find((i) => i.id === exec.id)!;
    expect(execItem.flags).toContain("executed_despite_decision");
    expect(execItem.parent.status).toBe("linked");
    expect(execItem.event.ranUnder).toMatchObject({ decision: "BLOCK" });

    const gatedItem = items.find((i) => i.event.decision?.evaluationId === gated.evaluationId)!;
    expect(gatedItem.flags).toEqual(expect.arrayContaining(["approval_required", "approval_pending"]));
    expect(gatedItem.event.decision!.approval).toMatchObject({ id: gated.approvalRequestId, status: "PENDING" });

    expect(run.graph.attention.map((a) => a.id)).toEqual(expect.arrayContaining([blockedItem.id, execItem.id, gatedItem.id]));
    expect(run.stats.decisions).toMatchObject({ BLOCK: 1, REQUIRE_APPROVAL: 1 });
    expect(run.stats.byStatus).toMatchObject({ BLOCKED: 1, APPROVAL_REQUIRED: 1 });
  });
});

describe("missing parents", () => {
  it("a parent id that points at nothing visible is 'unavailable', never invented", async () => {
    const trace = `${RUN_ID}-missing`;
    const ev = await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: agentA.id, eventType: "ACTION", action: "orphan.step", traceId: trace, parentEventId: null },
    });
    expect(ev.id).toBeTruthy();
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(run.graph.timeline[0].parent.status).toBe("root");
  });

  it("a parent in a different trace of the same agent is 'unavailable' for this run", async () => {
    const other = await report(agentA, { action: "elsewhere", traceId: `${RUN_ID}-elsewhere` });
    const trace = `${RUN_ID}-crosstrace`;
    await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: agentA.id, eventType: "ACTION", action: "crosstrace.child", traceId: trace, parentEventId: other.id },
    });
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(run.graph.timeline[0].parent).toMatchObject({ status: "unavailable", parentEventId: other.id });
    expect(JSON.stringify(run.graph)).not.toContain("elsewhere");
  });
});

describe("large runs: pagination and windowing", () => {
  const TRACE = `${RUN_ID}-large`;
  const N = 1_200;
  const ids: string[] = [];

  beforeAll(async () => {
    const base = Date.now() - 3_600_000;
    const rows: Prisma.ActivityEventCreateManyInput[] = [];
    for (let i = 0; i < N; i += 1) {
      const id = `${RUN_ID}-L${String(i).padStart(4, "0")}`;
      ids.push(id);
      rows.push({
        id,
        organizationId: orgA.id,
        agentId: agentA2.id,
        eventType: "TOOL_CALL",
        action: i % 7 === 0 ? "crm.export" : "crm.read",
        traceId: TRACE,
        timestamp: new Date(base + i * 100),
        toolKey: `tool-${i % 5}`,
        // 50 roots; everything else hangs off one of them, so later pages' parents live on page 1.
        parentEventId: i < 50 ? null : `${RUN_ID}-L${String(i % 50).padStart(4, "0")}`,
      });
    }
    await prisma.activityEvent.createMany({ data: rows });
  }, 120_000);

  it("pages through every event exactly once, in order, never loading more than a page", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let sawOutsidePage = false;
    do {
      const run: NonNullable<Awaited<ReturnType<typeof getRunGraph>>> = (await getRunGraph(orgA.id, asRef(agentA2), TRACE, { cursor, limit: 200 }))!;
      pages += 1;
      expect(run.page.returned).toBeLessThanOrEqual(200);
      expect(run.stats.events).toBe(N); // whole-run totals on every page
      const pageIds = flat(run.graph.timeline).map((i) => i.id);
      expect(pageIds).toHaveLength(run.page.returned);
      seen.push(...pageIds);
      if (run.graph.timeline.some((t) => t.parent.status === "outside_page")) sawOutsidePage = true;
      cursor = run.page.nextCursor;
    } while (cursor);

    expect(pages).toBe(6);
    expect(new Set(seen).size).toBe(N);
    expect(seen.length).toBe(N);
    expect(sawOutsidePage).toBe(true);
  }, 60_000);

  it("clamps the page size and never returns an unbounded graph", async () => {
    const run = (await getRunGraph(orgA.id, asRef(agentA2), TRACE, { limit: 100_000 }))!;
    expect(run.page.size).toBe(GRAPH_LIMITS.eventsMax);
    expect(run.page.returned).toBe(GRAPH_LIMITS.eventsMax);
    expect(run.page.nextCursor).toBeTruthy();
    const tiny = (await getRunGraph(orgA.id, asRef(agentA2), TRACE, { limit: 0 }))!;
    expect(tiny.page.size).toBe(1);
  });

  it("a garbage cursor is ignored (starts from the beginning), never an error or a leak", async () => {
    const run = (await getRunGraph(orgA.id, asRef(agentA2), TRACE, { cursor: "not-a-cursor", limit: 5 }))!;
    expect(flat(run.graph.timeline)[0]?.id ?? run.graph.timeline[0].id).toBeTruthy();
    expect(run.page.returned).toBe(5);
  });

  it("lists runs newest-first, paginated with no repeats, summarized, and bounded by the window", async () => {
    const agent = await makeAgent(orgA.id, "p6-runs");
    const now = Date.now();
    for (let r = 0; r < 5; r += 1) {
      await prisma.activityEvent.create({
        data: {
          organizationId: orgA.id,
          agentId: agent.id,
          eventType: "ACTION",
          action: `run.${r}`,
          traceId: `${RUN_ID}-run-${r}`,
          timestamp: new Date(now - (5 - r) * 60_000),
          status: r === 2 ? "BLOCKED" : "ALLOWED",
          riskLevel: r === 3 ? "HIGH" : "LOW",
          toolKey: "crm",
          destination: "a.example.com",
        },
      });
    }
    await prisma.activityEvent.create({ data: { organizationId: orgA.id, agentId: agent.id, eventType: "ACTION", action: "too.old", traceId: `${RUN_ID}-old`, timestamp: new Date(now - 40 * DAY) } });
    await prisma.activityEvent.create({ data: { organizationId: orgA.id, agentId: agent.id, eventType: "ACTION", action: "no.trace" } });

    const collected: string[] = [];
    let cursor: string | null = null;
    let first = true;
    do {
      const list = await listRuns(orgA.id, agent.id, { limit: 2, cursor, days: 30 });
      if (first) {
        expect(list.ungroupedEvents).toBe(1);
        expect(list.scanTruncated).toBe(false);
        first = false;
      }
      collected.push(...list.runs.map((r) => r.traceId));
      cursor = list.nextCursor;
    } while (cursor);

    expect(collected).toEqual([4, 3, 2, 1, 0].map((r) => `${RUN_ID}-run-${r}`)); // newest first, no repeats, `old` excluded
    const all = await listRuns(orgA.id, agent.id, { limit: 50 });
    const byTrace = Object.fromEntries(all.runs.map((r) => [r.traceId, r]));
    expect(byTrace[`${RUN_ID}-run-2`]).toMatchObject({ blocked: 1, events: 1, firstAction: "run.2", tools: 1, destinations: 1 });
    expect(byTrace[`${RUN_ID}-run-3`].maxRisk).toBe("HIGH");
  });
});

describe("tenant isolation", () => {
  const SHARED = `${RUN_ID}-shared`;
  let bEventId: string;

  beforeAll(async () => {
    // The SAME trace id exists in both tenants.
    const b = await prisma.activityEvent.create({
      data: { organizationId: orgB.id, agentId: agentB.id, eventType: "ACTION", action: "b.secret.action", traceId: SHARED, toolKey: "b-tool", destination: "b.internal.example", dataClasses: ["CREDENTIALS"] },
    });
    bEventId = b.id;
    await report(agentA, { action: "a.public.action", traceId: SHARED });
  });

  it("a run only ever contains its own organization's events, even when trace ids collide", async () => {
    const run = (await getRunGraph(orgA.id, asRef(agentA), SHARED))!;
    expect(run.stats.events).toBe(1);
    expect(JSON.stringify(run)).not.toContain("b.secret.action");
    expect(JSON.stringify(run)).not.toContain("b.internal.example");
    expect(JSON.stringify(run)).not.toContain("b-tool");
    expect(run.stats.dataClasses).toEqual([]);
  });

  it("another tenant's agent or organization yields nothing, in every combination", async () => {
    expect(await getRunGraph(orgA.id, asRef(agentB), SHARED)).toBeNull(); // A's tenant, B's agent
    expect(await getRunGraph(orgB.id, asRef(agentA), SHARED)).toBeNull(); // B's tenant, A's agent
    expect((await listRuns(orgA.id, agentB.id)).runs).toEqual([]);
    expect((await listRuns(orgB.id, agentA.id)).runs).toEqual([]);
    expect((await listRuns(orgB.id, agentB.id)).runs.map((r) => r.traceId)).toContain(SHARED);
  });

  it("a parent pointer into another tenant (a row that should be impossible) is 'unavailable' and leaks nothing", async () => {
    const trace = `${RUN_ID}-poisoned`;
    await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: agentA.id, eventType: "ACTION", action: "poisoned.child", traceId: trace, parentEventId: bEventId },
    });
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(run.graph.timeline[0].parent).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(run)).not.toContain("b.secret.action");
    expect(run.graph.nodes.some((n) => n.id === `action:${bEventId}`)).toBe(false);
  });

  it("another tenant's evaluation or approval linked to an event is ignored, not displayed", async () => {
    const bDecision = await decide(agentB, { action: "refund.issue", traceId: `${RUN_ID}-b-eval` }, keyB);
    expect(bDecision.decision).toBe("REQUIRE_APPROVAL");
    const trace = `${RUN_ID}-poisoned-eval`;
    await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: agentA.id, eventType: "ACTION", action: "poisoned.exec", traceId: trace, evaluationId: bDecision.evaluationId },
    });
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    expect(run.graph.timeline[0].event.ranUnder).toBeNull();
    expect(JSON.stringify(run)).not.toContain(bDecision.evaluationId);
    expect(JSON.stringify(run)).not.toContain(bDecision.approvalRequestId!);
  });
});

describe("authorization", () => {
  const TRACE = `${RUN_ID}-api`;

  beforeAll(async () => {
    const root = await report(agentA, { action: "api.root", traceId: TRACE });
    for (let i = 0; i < 5; i += 1) await report(agentA, { action: `api.child.${i}`, traceId: TRACE, parentEventId: root.id });
  });

  it("the graph:read scope is required; keys created without it are refused", async () => {
    const response = await graphGet(keyNoScope, agentA.slug);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    expect((await graphGet(keyNoScope, agentA.slug, TRACE)).status).toBe(403);
  });

  it("no key, or a bogus key, is a 401", async () => {
    expect((await graphGet(null, agentA.slug)).status).toBe(401);
    expect((await graphGet("aeg_test_bogus", agentA.slug)).status).toBe(401);
  });

  it("new keys carry graph:read by default and can read their agent's runs and a run", async () => {
    const list = await graphGet(keyA, agentA.slug);
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.runs.map((r: { traceId: string }) => r.traceId)).toContain(TRACE);

    const run = await graphGet(keyA, agentA.slug, TRACE, "?limit=3");
    expect(run.status).toBe(200);
    const detail = await run.json();
    expect(detail.stats.events).toBe(6);
    expect(detail.page.returned).toBe(3);
    expect(detail.page.nextCursor).toBeTruthy();
    const next = await (await graphGet(keyA, agentA.slug, TRACE, `?limit=3&cursor=${detail.page.nextCursor}`)).json();
    expect(next.page.returned).toBe(3);
    expect(next.page.nextCursor).toBeNull();
    expect(typeof detail.graph.timeline[0].event.timestamp).toBe("string");
  });

  it("a key bound to one agent cannot read another agent's graph", async () => {
    const response = await graphGet(keyBoundToA2, agentA.slug, TRACE);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    expect((await graphGet(keyBoundToA2, agentA2.slug)).status).toBe(200);
  });

  it("another organization's key gets 404 for this agent and run — indistinguishable from not existing", async () => {
    const agent = await graphGet(keyB, agentA.slug);
    expect(agent.status).toBe(404);
    expect((await graphGet(keyB, agentA.slug, TRACE)).status).toBe(404);
    // Its own agent, someone else's trace id: not found.
    const own = await graphGet(keyB, agentB.slug, TRACE);
    expect(own.status).toBe(404);
    expect((await own.json()).error.code).toBe("RUN_NOT_FOUND");
  });

  it("rejects out-of-range paging parameters instead of loading more", async () => {
    expect((await graphGet(keyA, agentA.slug, TRACE, "?limit=100000")).status).toBe(400);
    expect((await graphGet(keyA, agentA.slug, TRACE, "?limit=0")).status).toBe(400);
    expect((await graphGet(keyA, agentA.slug, undefined, "?limit=51")).status).toBe(400);
    expect((await graphGet(keyA, agentA.slug, undefined, "?days=31")).status).toBe(400);
  });

  it("dashboard visibility follows the security view: every role with view_security, but not FINANCE", () => {
    const expected: Record<MemberRole, boolean> = { OWNER: true, ADMIN: true, ENGINEER: true, SECURITY: true, VIEWER: true, FINANCE: false };
    for (const [role, allowed] of Object.entries(expected)) expect(canViewActionGraph(role as MemberRole)).toBe(allowed);
  });
});

describe("only observable metadata is shown", () => {
  it("reasoning-shaped context never reaches the graph or the API; ordinary context does", async () => {
    const trace = `${RUN_ID}-reasoning`;
    await report(agentA, {
      action: "refund.decide",
      traceId: trace,
      metadata: { amount: 1250, reasoning: "The customer seems angry so I will refund them", chainOfThought: "step one: ...", note: "ok" },
    });
    const run = (await getRunGraph(orgA.id, asRef(agentA), trace))!;
    const event = run.graph.timeline[0].event;
    expect(event.contextWithheld).toBe(true);
    expect(event.context).toMatchObject({ amount: 1250, note: "ok", reasoning: "[withheld: reasoning content]" });

    const body = await (await graphGet(keyA, agentA.slug, trace)).text();
    expect(body).not.toContain("seems angry");
    expect(body).not.toContain("step one");
    expect(body).toContain("1250");
  });
});
