/**
 * P0 regression tests at the public API boundary — route handlers invoked
 * directly (no server), against the verified disposable test database.
 * Sections map to docs/AEGIS_P0_IMPLEMENTATION.md.
 */
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { withIdempotency } from "@/lib/api/idempotency";
import { createWebhookEndpoint } from "@/lib/webhooks/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";
import { GET as approvalsGet } from "@/app/api/v1/approvals/[id]/route";
import { POST as registerHandler } from "@/app/api/v1/agents/register/route";

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const RUN_ID = `test_p0r_${Date.now()}`;

let org: { id: string };
let otherOrg: { id: string };
let agentX: { id: string; slug: string };
let agentY: { id: string; slug: string };
let orgWideKey: string;
let boundKeyX: string;
let otherOrgKey: string;
let orgWideKeyId: string;

function post(path: string, key: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const evaluate = (key: string, body: unknown, headers?: Record<string, string>) =>
  evaluateHandler(post("/api/v1/evaluate", key, body, headers), ctx);
const track = (key: string, body: unknown) => eventsHandler(post("/api/v1/events", key, body), ctx);
const register = (key: string, body: unknown) => registerHandler(post("/api/v1/agents/register", key, body), ctx);
const getApproval = (key: string, id: string) =>
  approvalsGet(new Request(`http://localhost/api/v1/approvals/${id}`, { headers: { authorization: `Bearer ${key}` } }), {
    params: Promise.resolve({ id }),
  });

async function makeAgent(organizationId: string, slug: string) {
  return prisma.agent.create({
    data: { organizationId, name: slug, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m" },
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "P0 Routes", slug: `${RUN_ID}-org` } });
  otherOrg = await prisma.organization.create({ data: { name: "P0 Routes Other", slug: `${RUN_ID}-other` } });
  agentX = await makeAgent(org.id, "p0r-agent-x");
  agentY = await makeAgent(org.id, "p0r-agent-y");
  await makeAgent(otherOrg.id, "p0r-agent-x"); // same slug, different tenant

  for (const agentId of [agentX.id, agentY.id]) {
    await prisma.agentPermission.createMany({
      data: [
        { organizationId: org.id, agentId, action: "invoice.read", resource: "", decision: "ALLOW" },
        { organizationId: org.id, agentId, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" },
      ],
    });
  }

  const wide = await createApiKey(org.id, null, { name: "org-wide", environment: "TEST" });
  orgWideKey = wide.raw;
  orgWideKeyId = wide.apiKey.id;
  boundKeyX = (await createApiKey(org.id, null, { name: "bound-x", environment: "TEST", agentId: agentX.id })).raw;
  otherOrgKey = (await createApiKey(otherOrg.id, null, { name: "other", environment: "TEST" })).raw;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [org.id, otherOrg.id];
  await prisma.webhookDelivery.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// §1 kill switch through the public API
// ---------------------------------------------------------------------------

describe("§1 kill switch via POST /api/v1/evaluate", () => {
  it("returns BLOCK with decisionSource CONTROL and the agent's status", async () => {
    const stopped = await makeAgent(org.id, "p0r-stopped");
    await prisma.agentPermission.create({
      data: { organizationId: org.id, agentId: stopped.id, action: "invoice.read", resource: "", decision: "ALLOW" },
    });
    await prisma.agent.update({ where: { id: stopped.id }, data: { status: "STOPPED" } });

    const response = await evaluate(orgWideKey, { agent: stopped.slug, action: "invoice.read" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ decision: "BLOCK", decisionSource: "CONTROL", agentStatus: "STOPPED" });
    expect(body.reason).toMatch(/STOPPED/);
  });
});

// ---------------------------------------------------------------------------
// §6 idempotency
// ---------------------------------------------------------------------------

describe("§6 idempotency", () => {
  it("a retried request with the same key replays the same result and creates nothing new", async () => {
    const body = { agent: agentX.slug, action: "refund.issue", resource: "order:idem-1" };
    const headers = { "idempotency-key": `${RUN_ID}-idem-1` };
    const first = await (await evaluate(orgWideKey, body, headers)).json();
    const second = await (await evaluate(orgWideKey, body, headers)).json();
    expect(second).toEqual(first);
    expect(await prisma.policyEvaluation.count({ where: { organizationId: org.id, resource: "order:idem-1" } })).toBe(1);
    expect(await prisma.approvalRequest.count({ where: { organizationId: org.id, resource: "order:idem-1" } })).toBe(1);
  });

  it("concurrent retries with the same key run the handler once (others replay or are told to retry)", async () => {
    const body = { agent: agentX.slug, action: "refund.issue", resource: "order:idem-race" };
    const headers = { "idempotency-key": `${RUN_ID}-idem-race` };
    const responses = await Promise.all(Array.from({ length: 6 }, () => evaluate(orgWideKey, body, headers)));
    for (const response of responses) {
      if (response.status !== 200) {
        expect(response.status).toBe(409);
        expect((await response.json()).error.code).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");
      }
    }
    expect(responses.some((r) => r.status === 200)).toBe(true);
    expect(await prisma.policyEvaluation.count({ where: { organizationId: org.id, resource: "order:idem-race" } })).toBe(1);
    expect(await prisma.approvalRequest.count({ where: { organizationId: org.id, resource: "order:idem-race" } })).toBe(1);
  });

  it("reusing a key with a different body is a 409 conflict", async () => {
    const headers = { "idempotency-key": `${RUN_ID}-idem-conflict` };
    await evaluate(orgWideKey, { agent: agentX.slug, action: "invoice.read" }, headers);
    const response = await evaluate(orgWideKey, { agent: agentX.slug, action: "invoice.read", resource: "x" }, headers);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("legitimate repeated executions (no key, or different keys) are each recorded", async () => {
    const body = { agent: agentX.slug, action: "invoice.read", resource: "inv:repeat" };
    await evaluate(orgWideKey, body);
    await evaluate(orgWideKey, body);
    await evaluate(orgWideKey, body, { "idempotency-key": `${RUN_ID}-a` });
    await evaluate(orgWideKey, body, { "idempotency-key": `${RUN_ID}-b` });
    expect(await prisma.policyEvaluation.count({ where: { organizationId: org.id, resource: "inv:repeat" } })).toBe(4);
  });

  it("a failed handler releases its claim so a retry can actually run", async () => {
    const params = { organizationId: org.id, apiKeyId: orgWideKeyId, operation: "test.op", idempotencyKey: `${RUN_ID}-fail`, requestBody: { a: 1 } };
    await expect(withIdempotency(params, async () => Promise.reject(new Error("transient")))).rejects.toThrow("transient");
    const retried = await withIdempotency(params, async () => ({ status: 201, body: { ok: true } }));
    expect(retried).toEqual({ status: 201, body: { ok: true } });
  });

  it("a fresh unfinished claim is respected (409 in progress), but an abandoned one (crashed process) is reclaimed", async () => {
    const params = { organizationId: org.id, apiKeyId: orgWideKeyId, operation: "test.op", idempotencyKey: `${RUN_ID}-stale`, requestBody: { a: 1 } };
    await prisma.idempotencyRecord.create({
      data: {
        organizationId: org.id,
        apiKeyId: orgWideKeyId,
        operation: "test.op",
        key: `${RUN_ID}-stale`,
        requestHash: createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"),
        statusCode: 0,
        responseBody: {},
        completedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const handler = vi.fn(async () => ({ status: 200, body: { ran: true } }));
    await expect(withIdempotency(params, handler)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_IN_PROGRESS" });
    expect(handler).not.toHaveBeenCalled();

    await prisma.idempotencyRecord.updateMany({
      where: { key: `${RUN_ID}-stale` },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    expect(await withIdempotency(params, handler)).toEqual({ status: 200, body: { ran: true } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("an expired record no longer blocks reuse of its key", async () => {
    const params = { organizationId: org.id, apiKeyId: orgWideKeyId, operation: "test.op", idempotencyKey: `${RUN_ID}-exp`, requestBody: { a: 1 } };
    await withIdempotency(params, async () => ({ status: 200, body: { run: 1 } }));
    await prisma.idempotencyRecord.updateMany({ where: { key: `${RUN_ID}-exp` }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await withIdempotency(params, async () => ({ status: 200, body: { run: 2 } }))).toEqual({ status: 200, body: { run: 2 } });
  });
});

// ---------------------------------------------------------------------------
// §7 agent authorization
// ---------------------------------------------------------------------------

describe("§7 API key → agent authorization", () => {
  it("a key bound to agent X may act as X", async () => {
    expect((await track(boundKeyX, { agent: agentX.slug, eventType: "ACTION", action: "invoice.read" })).status).toBe(201);
    expect((await evaluate(boundKeyX, { agent: agentX.slug, action: "invoice.read" })).status).toBe(200);
  });

  it("a key bound to agent X can't send events for, or evaluate as, agent Y", async () => {
    const event = await track(boundKeyX, { agent: agentY.slug, eventType: "ACTION", action: "invoice.read" });
    expect(event.status).toBe(403);
    expect((await event.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    const decision = await evaluate(boundKeyX, { agent: agentY.slug, action: "invoice.read" });
    expect(decision.status).toBe(403);
    expect(await prisma.activityEvent.count({ where: { agentId: agentY.id, action: "invoice.read", source: "api" } })).toBe(0);
  });

  it("a key bound to agent X can't read agent Y's approvals (reported as not found)", async () => {
    const created = await (await evaluate(orgWideKey, { agent: agentY.slug, action: "refund.issue", resource: "order:y" })).json();
    expect((await getApproval(orgWideKey, created.approvalRequestId)).status).toBe(200);
    expect((await getApproval(boundKeyX, created.approvalRequestId)).status).toBe(404);
  });

  it("a key bound to agent X can't register other agents, but may 'register' X itself (idempotent quickstart)", async () => {
    const other = await register(boundKeyX, { name: "brand new agent" });
    expect(other.status).toBe(403);
    expect((await other.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    expect((await register(boundKeyX, { name: agentY.slug })).status).toBe(403);
    const self = await register(boundKeyX, { name: agentX.slug });
    expect(self.status).toBe(200);
    expect((await self.json()).id).toBe(agentX.id);
  });

  it("tenant isolation: another organization's key never reaches this org's agent of the same slug", async () => {
    const response = await evaluate(otherOrgKey, { agent: agentY.slug, action: "invoice.read" });
    expect(response.status).toBe(404);
    const sameSlug = await (await evaluate(otherOrgKey, { agent: agentX.slug, action: "invoice.read" })).json();
    const evaluation = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: sameSlug.evaluationId } });
    expect(evaluation.organizationId).toBe(otherOrg.id);
    expect(evaluation.agentId).not.toBe(agentX.id);
  });

  it("GET /approvals exposes expiry and single-use state", async () => {
    const created = await (await evaluate(orgWideKey, { agent: agentX.slug, action: "refund.issue", resource: "order:fields" })).json();
    expect(created.approvalExpiresAt).toEqual(expect.any(String));
    const body = await (await getApproval(orgWideKey, created.approvalRequestId)).json();
    expect(body).toMatchObject({ status: "PENDING", consumed: false, consumedAt: null, executionExpiresAt: null });
    expect(body.expiresAt).toBe(created.approvalExpiresAt);
  });
});

// ---------------------------------------------------------------------------
// §8 plan agent limit
// ---------------------------------------------------------------------------

describe("§8 plan agent limit via POST /api/v1/agents/register", () => {
  let limitOrg: { id: string };
  let limitKey: string;
  let limitBoundKey: string;
  let existing: { id: string; slug: string };

  beforeAll(async () => {
    // Free plan: 3 agents (lib/billing/plans.ts).
    limitOrg = await prisma.organization.create({ data: { name: "P0 Limit", slug: `${RUN_ID}-limit`, plan: "free" } });
    existing = await makeAgent(limitOrg.id, "limit-one");
    await makeAgent(limitOrg.id, "limit-two");
    limitKey = (await createApiKey(limitOrg.id, null, { name: "wide", environment: "TEST" })).raw;
    limitBoundKey = (await createApiKey(limitOrg.id, null, { name: "bound", environment: "TEST", agentId: existing.id })).raw;
  });

  afterAll(async () => {
    await drainDeferredTasks();
    await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.securityAlert.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.idempotencyRecord.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.activityEvent.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.apiKey.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.agent.deleteMany({ where: { organizationId: limitOrg.id } });
    await prisma.organization.deleteMany({ where: { id: limitOrg.id } });
  });

  it("concurrent registrations racing for the last slot create exactly one agent", async () => {
    const responses = await Promise.all(["race a", "race b", "race c", "race d"].map((name) => register(limitKey, { name })));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of responses.filter((r) => r.status !== 201)) {
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("PLAN_LIMIT_REACHED");
    }
    expect(await prisma.agent.count({ where: { organizationId: limitOrg.id } })).toBe(3);
  });

  it("at the limit, creation is blocked and nothing is created", async () => {
    const response = await register(limitKey, { name: "one too many" });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("PLAN_LIMIT_REACHED");
    expect(await prisma.agent.count({ where: { organizationId: limitOrg.id } })).toBe(3);
  });

  it("existing agents keep working at the limit (register returns them; events still ingest)", async () => {
    const again = await register(limitKey, { name: existing.slug });
    expect(again.status).toBe(200);
    expect((await track(limitKey, { agent: existing.slug, eventType: "ACTION", action: "invoice.read" })).status).toBe(201);
  });

  it("a bound key can't be used to get around the limit either", async () => {
    const response = await register(limitBoundKey, { name: "sneaky new agent" });
    expect(response.status).toBe(403);
    expect(await prisma.agent.count({ where: { organizationId: limitOrg.id } })).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §9 webhook delivery is off the decision path
// ---------------------------------------------------------------------------

describe("§9 /evaluate does not wait on webhook delivery", () => {
  it("returns well before a slow, failing webhook endpoint finishes its retries", async () => {
    await createWebhookEndpoint(org.id, null, { url: "https://8.8.8.8/p0-slow-hook", subscribedEvents: ["approval.requested"] });
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("down", { status: 503 })), 700))
    );
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    const response = await evaluate(orgWideKey, { agent: agentX.slug, action: "refund.issue", resource: "order:webhook-latency" });
    const decisionLatencyMs = Date.now() - startedAt;
    expect(response.status).toBe(200);
    expect((await response.json()).decision).toBe("REQUIRE_APPROVAL");
    // Inline delivery used to cost 3 × 700ms + 1.5s backoff ≈ 3.6s here.
    expect(decisionLatencyMs).toBeLessThan(1500);

    await drainDeferredTasks();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await prisma.webhookDelivery.count({ where: { organizationId: org.id, eventType: "approval.requested" } })).toBe(3);
  });
});
