/**
 * P1 — agent data foundation, end to end through the public API route
 * handlers against the verified disposable test database
 * (lib/testing/test-db-guard.ts). Sections map to
 * docs/AEGIS_P1_DATA_FOUNDATION.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { getActivityByTraceId, getActivityEvent, listActivityEvents } from "@/lib/activity/queries";
import { getEventLineage } from "@/lib/telemetry/lineage";
import { normalizeKey } from "@/lib/telemetry/normalize";
import { activityFiltersSchema } from "@/lib/validation/activity";
import { resolveApproval } from "@/lib/approvals/service";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const RUN_ID = `test_p1_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string; slug: string };
let agentA2: { id: string; slug: string };
let agentB: { id: string; slug: string };
let keyA: string;
let keyA2Bound: string;
let keyB: string;
let approver: { id: string };

function post(path: string, key: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const track = (key: string, body: unknown, headers?: Record<string, string>) =>
  eventsHandler(post("/api/v1/events", key, body, headers), ctx);
// This file makes well over 60 calls for org A; spread them across a pool of
// org-wide keys so the (correct) 60/min per-key rate limit doesn't interfere.
const keyAPool: string[] = [];
let poolIndex = 0;
const pooled = (key: string) => (key === keyA && keyAPool.length > 0 ? keyAPool[poolIndex++ % keyAPool.length] : key);
const evaluate = (key: string, body: unknown) => evaluateHandler(post("/api/v1/evaluate", pooled(key), body), ctx);

async function trackOk(key: string, body: Record<string, unknown>) {
  const response = await track(pooled(key), { eventType: "ACTION", action: "task.run", ...body });
  const json = await response.json();
  if (response.status !== 201 && response.status !== 200) throw new Error(`track failed ${response.status}: ${JSON.stringify(json)}`);
  return json as { id: string; traceId: string | null; parentEventId: string | null; duplicate: boolean };
}

async function makeAgent(organizationId: string, slug: string, environment: "PRODUCTION" | "STAGING" = "PRODUCTION") {
  return prisma.agent.create({
    data: { organizationId, name: slug, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m", environment },
  });
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P1 Org A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P1 Org B", slug: `${RUN_ID}-b` } });
  agentA = await makeAgent(orgA.id, "p1-agent-a");
  agentA2 = await makeAgent(orgA.id, "p1-agent-a2", "STAGING");
  agentB = await makeAgent(orgB.id, "p1-agent-b");
  keyA = (await createApiKey(orgA.id, null, { name: "a", environment: "TEST" })).raw;
  keyA2Bound = (await createApiKey(orgA.id, null, { name: "a2", environment: "TEST", agentId: agentA2.id })).raw;
  keyB = (await createApiKey(orgB.id, null, { name: "b", environment: "TEST" })).raw;
  for (let i = 0; i < 4; i += 1) {
    keyAPool.push((await createApiKey(orgA.id, null, { name: `a-pool-${i}`, environment: "TEST" })).raw);
  }
  approver = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "P1 Approver" } });

  for (const agentId of [agentA.id, agentA2.id]) {
    await prisma.agentPermission.createMany({
      data: [
        { organizationId: orgA.id, agentId, action: "crm.export", resource: "", decision: "ALLOW" },
        { organizationId: orgA.id, agentId, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" },
        { organizationId: orgA.id, agentId, action: "files.delete", resource: "", decision: "BLOCK" },
      ],
    });
  }
});

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: approver.id } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// §1 event creation / §4 normalization / §8 privacy
// ---------------------------------------------------------------------------

describe("event creation with structured telemetry", () => {
  it("stores every field normalized, with server-side environment and no raw sensitive values", async () => {
    const occurredAt = new Date(Date.now() - 5 * 60 * 1000);
    const result = await trackOk(keyA, {
      agent: agentA.slug,
      eventType: "DATA_ACCESS",
      action: "crm.export",
      tool: "  HubSpot CRM ",
      service: "HubSpot API",
      destination: "https://svc:pa55word@Files.Example-Share.io:8443/upload?token=abc123",
      endUserId: "jane.doe@customer.example",
      dataClasses: ["pii", "FINANCIAL"],
      recordCount: 1200,
      byteCount: 524288,
      occurredAt: occurredAt.toISOString(),
      status: "SUCCESS",
      clientEventId: `${RUN_ID}-create-1`,
    });
    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: result.id } });

    expect(event).toMatchObject({
      toolName: "  HubSpot CRM ".trim(),
      toolKey: "hubspot-crm",
      service: "hubspot-api",
      destination: "files.example-share.io",
      destinationKind: "HOST",
      dataClasses: ["PII", "FINANCIAL"],
      dataSensitivity: "HIGH",
      recordCount: 1200,
      byteCount: 524288,
      outcome: "SUCCESS",
      environment: "PRODUCTION",
      clientEventId: `${RUN_ID}-create-1`,
      source: "api",
    });
    expect(event.occurredAt?.toISOString()).toBe(occurredAt.toISOString());
    expect(event.endUserHash).toMatch(/^(as|tk)[0-9a-f]{6}:[0-9a-f]{32}$/);
    expect((event.riskSignals as { code: string }[]).map((s) => s.code)).toContain("sensitive_data");

    const stored = JSON.stringify(event);
    for (const secretish of ["jane.doe", "pa55word", "abc123", "upload", "8443"]) expect(stored).not.toContain(secretish);
  });

  it("accepts an event with no optional fields: unknowns are null/empty, never guessed", async () => {
    const result = await trackOk(keyA, { agent: agentA.slug, action: "docs.read" });
    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: result.id } });
    expect(event).toMatchObject({
      service: null,
      destination: null,
      destinationKind: null,
      endUserHash: null,
      dataClasses: [],
      dataSensitivity: null,
      recordCount: null,
      byteCount: null,
      clientEventId: null,
      parentEventId: null,
      occurredAt: null,
      outcome: "SUCCESS",
      environment: "PRODUCTION",
    });
  });

  it("rejects malformed events with 400 and records nothing", async () => {
    const before = await prisma.activityEvent.count({ where: { organizationId: orgA.id } });
    for (const bad of [
      { destination: "not a host" },
      { dataClasses: ["NOPE"] },
      { recordCount: -5 },
      { clientEventId: "bad id with spaces" },
      { occurredAt: "2099-01-01T00:00:00Z" },
      { parentEventId: "x", parentClientEventId: "y" },
    ]) {
      const response = await track(keyA, { agent: agentA.slug, eventType: "ACTION", action: "x.y", ...bad });
      expect(response.status).toBe(400);
    }
    expect(await prisma.activityEvent.count({ where: { organizationId: orgA.id } })).toBe(before);
  });

  it("redacts secret-shaped keys and recognizable credential values before storage", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = await trackOk(keyA, {
      agent: agentA.slug,
      action: "crm.sync",
      description: `synced using ${jwt}`,
      metadata: { apiKey: "plain-secret-value", note: "key sk-proj-abcdefghijklmnopqrstuvwxyz0123 used", count: 3 },
    });
    const event = await prisma.activityEvent.findUniqueOrThrow({ where: { id: result.id } });
    const stored = JSON.stringify(event);
    expect(stored).not.toContain(jwt);
    expect(stored).not.toContain("plain-secret-value");
    expect(stored).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz0123");
    expect(event.description).toBe("synced using [REDACTED]");
    expect(event.metadata).toMatchObject({ apiKey: "[REDACTED]", note: "key [REDACTED] used", count: 3 });
    const codes = (event.riskSignals as { code: string; detail?: { kinds?: string[] } }[]).map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["secret_shaped_fields", "secret_values_redacted"]));
  });

  it("normalized tool keys make spelling variants one tool (filter + new-tool detection)", async () => {
    await trackOk(keyA, { agent: agentA.slug, action: "ticket.read", tool: "Zendesk" });
    await trackOk(keyA, { agent: agentA.slug, action: "ticket.read", tool: "ZENDESK" });
    await drainDeferredTasks();
    const { total } = await listActivityEvents(orgA.id, activityFiltersSchema.parse({ toolName: "zendesk" }));
    expect(total).toBe(2);
    const newToolAlerts = await prisma.securityAlert.findMany({
      where: { agentId: agentA.id, type: "NEW_TOOL_USAGE", dedupeKey: `tool:${normalizeKey("Zendesk")}` },
    });
    expect(newToolAlerts).toHaveLength(1);
    expect(newToolAlerts[0].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §2 parent / child
// ---------------------------------------------------------------------------

describe("parent / child lineage", () => {
  it("links a child to its parent by Aegis id and inherits the parent's trace", async () => {
    const task = await trackOk(keyA, { agent: agentA.slug, action: "task.run", traceId: `${RUN_ID}-trace-1` });
    const tool = await trackOk(keyA, { agent: agentA.slug, eventType: "TOOL_CALL", action: "tool.call", parentEventId: task.id });
    const api = await trackOk(keyA, { agent: agentA.slug, action: "api.call", parentEventId: tool.id });
    expect(tool.parentEventId).toBe(task.id);
    expect(tool.traceId).toBe(`${RUN_ID}-trace-1`);
    expect(api.traceId).toBe(`${RUN_ID}-trace-1`);

    const lineage = await getEventLineage(orgA.id, api.id);
    expect(lineage.ancestors.map((a) => a.id)).toEqual([task.id, tool.id]);
    expect((await getEventLineage(orgA.id, task.id)).children.map((c) => c.id)).toEqual([tool.id]);
  });

  it("rejects a parent that doesn't exist, is in another organization, or has a conflicting trace", async () => {
    const otherOrgEvent = await trackOk(keyB, { agent: agentB.slug, action: "task.run" });
    for (const parentEventId of ["does-not-exist", otherOrgEvent.id]) {
      const response = await track(keyA, { agent: agentA.slug, eventType: "ACTION", action: "x.y", parentEventId });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_PARENT_EVENT");
    }
    const parent = await trackOk(keyA, { agent: agentA.slug, action: "task.run", traceId: `${RUN_ID}-trace-x` });
    const mismatch = await track(keyA, {
      agent: agentA.slug,
      eventType: "ACTION",
      action: "x.y",
      parentEventId: parent.id,
      traceId: `${RUN_ID}-different`,
    });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.code).toBe("PARENT_TRACE_MISMATCH");
  });

  it("links a child that arrived before its parent (parentClientEventId) once the parent is reported", async () => {
    const child = await trackOk(keyA, {
      agent: agentA.slug,
      action: "api.call",
      clientEventId: `${RUN_ID}-late-child`,
      parentClientEventId: `${RUN_ID}-late-parent`,
    });
    expect(child.parentEventId).toBeNull();
    const parent = await trackOk(keyA, { agent: agentA.slug, action: "task.run", clientEventId: `${RUN_ID}-late-parent` });
    const linked = await prisma.activityEvent.findUniqueOrThrow({ where: { id: child.id } });
    expect(linked.parentEventId).toBe(parent.id);

    // and a later child resolves immediately
    const immediate = await trackOk(keyA, { agent: agentA.slug, action: "api.call", parentClientEventId: `${RUN_ID}-late-parent` });
    expect(immediate.parentEventId).toBe(parent.id);
  });

  it("never creates a cycle through late linking", async () => {
    const a = await trackOk(keyA, {
      agent: agentA.slug,
      action: "a.step",
      clientEventId: `${RUN_ID}-cyc-a`,
      parentClientEventId: `${RUN_ID}-cyc-b`,
    });
    const b = await trackOk(keyA, {
      agent: agentA.slug,
      action: "b.step",
      clientEventId: `${RUN_ID}-cyc-b`,
      parentClientEventId: `${RUN_ID}-cyc-a`,
    });
    // b found a as its parent; linking a under b would make a its own ancestor — skipped.
    expect(b.parentEventId).toBe(a.id);
    expect((await prisma.activityEvent.findUniqueOrThrow({ where: { id: a.id } })).parentEventId).toBeNull();
  });

  it("parentClientEventId is scoped to the same agent (no cross-agent resolution)", async () => {
    await trackOk(keyA, { agent: agentA.slug, action: "task.run", clientEventId: `${RUN_ID}-scoped` });
    const other = await trackOk(keyA, { agent: agentA2.slug, action: "api.call", parentClientEventId: `${RUN_ID}-scoped` });
    expect(other.parentEventId).toBeNull();
  });

  it("an agent-bound key can't attach to another agent's events; an org-wide key can", async () => {
    const aEvent = await trackOk(keyA, { agent: agentA.slug, action: "task.run" });
    const bound = await track(keyA2Bound, { agent: agentA2.slug, eventType: "ACTION", action: "x.y", parentEventId: aEvent.id });
    expect(bound.status).toBe(400);
    const orgWide = await trackOk(keyA, { agent: agentA2.slug, action: "x.y", parentEventId: aEvent.id });
    expect(orgWide.parentEventId).toBe(aEvent.id);
  });

  it("links an execution to its decision: evaluationId defaults the parent to the decision event", async () => {
    const decision = await (await evaluate(keyA, { agent: agentA.slug, action: "crm.export", recordCount: 50 })).json();
    const execution = await trackOk(keyA, {
      agent: agentA.slug,
      eventType: "DATA_ACCESS",
      action: "crm.export",
      evaluationId: decision.evaluationId,
      recordCount: 50,
    });
    const evaluation = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: decision.evaluationId } });
    expect(execution.parentEventId).toBe(evaluation.activityEventId);
    expect(execution.traceId).toBe(decision.traceId);
    const row = await prisma.activityEvent.findUniqueOrThrow({ where: { id: execution.id } });
    expect(row.evaluationId).toBe(decision.evaluationId);
  });

  it("records (as a signal) an execution reported under a BLOCK decision; rejects another agent's evaluation", async () => {
    const blocked = await (await evaluate(keyA, { agent: agentA.slug, action: "files.delete" })).json();
    expect(blocked.decision).toBe("BLOCK");
    const execution = await trackOk(keyA, { agent: agentA.slug, action: "files.delete", evaluationId: blocked.evaluationId });
    const row = await prisma.activityEvent.findUniqueOrThrow({ where: { id: execution.id } });
    expect((row.riskSignals as { code: string }[]).map((s) => s.code)).toContain("executed_despite_decision");

    const wrongAgent = await track(keyA, { agent: agentA2.slug, eventType: "ACTION", action: "x.y", evaluationId: blocked.evaluationId });
    expect(wrongAgent.status).toBe(400);
    expect((await wrongAgent.json()).error.code).toBe("INVALID_EVALUATION_REFERENCE");
  });
});

// ---------------------------------------------------------------------------
// §3 immutability
// ---------------------------------------------------------------------------

describe("immutability of security evidence (database-enforced)", () => {
  it("rejects rewriting an activity event, evaluation, audit event, or alert occurrence", async () => {
    const event = await trackOk(keyA, { agent: agentA.slug, action: "evidence.test" });
    await expect(prisma.activityEvent.update({ where: { id: event.id }, data: { action: "rewritten.action" } })).rejects.toThrow(
      /append-only/
    );
    await expect(prisma.activityEvent.update({ where: { id: event.id }, data: { status: "ALLOWED", riskLevel: "LOW", outcome: "FAILURE" } })).rejects.toThrow(
      /append-only/
    );
    await expect(
      prisma.$executeRaw`UPDATE "activity_events" SET "timestamp" = NOW() - INTERVAL '1 day' WHERE "id" = ${event.id}`
    ).rejects.toThrow(/append-only/);

    const decision = await (await evaluate(keyA, { agent: agentA.slug, action: "crm.export" })).json();
    await expect(
      prisma.policyEvaluation.update({ where: { id: decision.evaluationId }, data: { decision: "BLOCK" } })
    ).rejects.toThrow(/append-only/);

    const audit = await prisma.auditEvent.create({
      data: { organizationId: orgA.id, actorType: "SYSTEM", eventType: "agent.updated", entityType: "Agent", entityId: agentA.id, action: "x" },
    });
    await expect(prisma.auditEvent.update({ where: { id: audit.id }, data: { action: "changed" } })).rejects.toThrow(/append-only/);
  });

  it("allows only the one-time parent link, never re-pointing it", async () => {
    const parent = await trackOk(keyA, { agent: agentA.slug, action: "task.run" });
    const other = await trackOk(keyA, { agent: agentA.slug, action: "task.run" });
    const child = await trackOk(keyA, { agent: agentA.slug, action: "api.call" });
    await prisma.activityEvent.update({ where: { id: child.id }, data: { parentEventId: parent.id } });
    await expect(prisma.activityEvent.update({ where: { id: child.id }, data: { parentEventId: other.id } })).rejects.toThrow(
      /append-only/
    );
  });

  it("still allows deletion (organization removal / future retention) and nulls children's link", async () => {
    const parent = await trackOk(keyA, { agent: agentA.slug, action: "task.run" });
    const child = await trackOk(keyA, { agent: agentA.slug, action: "api.call", parentEventId: parent.id });
    await prisma.activityEvent.delete({ where: { id: parent.id } });
    expect((await prisma.activityEvent.findUniqueOrThrow({ where: { id: child.id } })).parentEventId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §5 idempotency
// ---------------------------------------------------------------------------

describe("idempotent ingestion", () => {
  it("re-delivery of the same clientEventId returns the original (200, duplicate) and writes nothing", async () => {
    const body = { agent: agentA.slug, eventType: "ACTION", action: "invoice.send", clientEventId: `${RUN_ID}-dup-1` };
    const first = await track(keyA, body);
    const second = await track(keyA, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const [a, b] = [await first.json(), await second.json()];
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(await prisma.activityEvent.count({ where: { organizationId: orgA.id, clientEventId: `${RUN_ID}-dup-1` } })).toBe(1);
  });

  it("different content under the same clientEventId is a 409 conflict", async () => {
    await trackOk(keyA, { agent: agentA.slug, action: "invoice.send", clientEventId: `${RUN_ID}-dup-2` });
    const response = await track(keyA, { agent: agentA.slug, eventType: "ACTION", action: "invoice.void", clientEventId: `${RUN_ID}-dup-2` });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CLIENT_EVENT_ID_CONFLICT");
  });

  it("concurrent deliveries of the same clientEventId record exactly one event", async () => {
    const body = { agent: agentA.slug, eventType: "ACTION", action: "invoice.send", clientEventId: `${RUN_ID}-dup-race` };
    const responses = await Promise.all(Array.from({ length: 6 }, () => track(keyA, body)));
    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.activityEvent.count({ where: { organizationId: orgA.id, clientEventId: `${RUN_ID}-dup-race` } })).toBe(1);
  });

  it("clientEventId is namespaced per agent; events without one are never deduplicated", async () => {
    await trackOk(keyA, { agent: agentA.slug, action: "invoice.send", clientEventId: `${RUN_ID}-shared` });
    await trackOk(keyA, { agent: agentA2.slug, action: "invoice.send", clientEventId: `${RUN_ID}-shared` });
    expect(await prisma.activityEvent.count({ where: { organizationId: orgA.id, clientEventId: `${RUN_ID}-shared` } })).toBe(2);

    await trackOk(keyA, { agent: agentA.slug, action: "repeat.me" });
    await trackOk(keyA, { agent: agentA.slug, action: "repeat.me" });
    expect(await prisma.activityEvent.count({ where: { agentId: agentA.id, action: "repeat.me" } })).toBe(2);
  });

  it("the P0 Idempotency-Key path still deduplicates retries of events without a clientEventId", async () => {
    const body = { agent: agentA.slug, eventType: "ACTION", action: "retry.me" };
    const headers = { "idempotency-key": `${RUN_ID}-idem` };
    const a = await (await track(keyA, body, headers)).json();
    const b = await (await track(keyA, body, headers)).json();
    expect(b.id).toBe(a.id);
    expect(await prisma.activityEvent.count({ where: { agentId: agentA.id, action: "retry.me" } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §7 tenant isolation
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  it("no event query returns another organization's events", async () => {
    const sharedTrace = `${RUN_ID}-shared-trace`;
    const aEvent = await trackOk(keyA, { agent: agentA.slug, action: "iso.check", traceId: sharedTrace });
    const bEvent = await trackOk(keyB, { agent: agentB.slug, action: "iso.check", traceId: sharedTrace });

    expect(await getActivityEvent(orgA.id, bEvent.id)).toBeNull();
    expect(await getActivityEvent(orgB.id, aEvent.id)).toBeNull();
    expect((await getActivityByTraceId(orgA.id, sharedTrace)).map((e) => e.id)).toEqual([aEvent.id]);
    const { events } = await listActivityEvents(orgA.id, activityFiltersSchema.parse({ q: "iso.check" }));
    expect(events.every((e) => e.organizationId === orgA.id)).toBe(true);
    expect(events.map((e) => e.id)).not.toContain(bEvent.id);

    const lineageAcrossTenants = await getEventLineage(orgA.id, bEvent.id);
    expect(lineageAcrossTenants).toEqual({ ancestors: [], children: [], childCount: 0 });
  });

  it("the same clientEventId in two organizations never collides or links across tenants", async () => {
    const a = await trackOk(keyA, { agent: agentA.slug, action: "task.run", clientEventId: `${RUN_ID}-tenant` });
    const b = await trackOk(keyB, { agent: agentB.slug, action: "task.run", clientEventId: `${RUN_ID}-tenant` });
    expect(a.id).not.toBe(b.id);
    expect(b.duplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /evaluate telemetry
// ---------------------------------------------------------------------------

describe("/evaluate telemetry", () => {
  it("stores structured context on the decision event (no outcome — nothing executed yet)", async () => {
    const decision = await (
      await evaluate(keyA, {
        agent: agentA2.slug,
        action: "crm.export",
        environment: "production",
        destination: "partner@Example.org",
        dataClasses: ["pii"],
        recordCount: 10,
        endUserId: "user_77",
      })
    ).json();
    const evaluation = await prisma.policyEvaluation.findUniqueOrThrow({
      where: { id: decision.evaluationId },
      include: { activityEvent: true },
    });
    expect(evaluation.activityEvent).toMatchObject({
      destination: "example.org",
      destinationKind: "EMAIL_DOMAIN",
      dataClasses: ["PII"],
      dataSensitivity: "HIGH",
      recordCount: 10,
      outcome: null,
      environment: "STAGING",
    });
    expect(evaluation.activityEvent?.endUserHash).toMatch(/:/);
    const codes = (evaluation.activityEvent?.riskSignals as { code: string }[]).map((s) => s.code);
    expect(codes).toContain("claimed_environment_ignored");
  });

  it("an approval granted for one volume/destination can't be consumed for another", async () => {
    const request = { agent: agentA.slug, action: "refund.issue", resource: "order:p1", recordCount: 1, destination: "pay.example.com" };
    const first = await (await evaluate(keyA, request)).json();
    expect(first.decision).toBe("REQUIRE_APPROVAL");
    await resolveApproval(orgA.id, first.approvalRequestId, approver.id, "APPROVED");

    const bigger = await (await evaluate(keyA, { ...request, recordCount: 5000, approvalRequestId: first.approvalRequestId })).json();
    expect(bigger).toMatchObject({ decision: "BLOCK", approvalDenialCode: "APPROVAL_REQUEST_MISMATCH" });
    const exact = await (await evaluate(keyA, { ...request, approvalRequestId: first.approvalRequestId })).json();
    expect(exact.decision).toBe("ALLOW");
  });

  it("a bad parent reference on /evaluate is a 400 (not an engine failure) and records no decision", async () => {
    const before = await prisma.policyEvaluation.count({ where: { organizationId: orgA.id } });
    const response = await evaluate(keyA, { agent: agentA.slug, action: "crm.export", parentEventId: "missing" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_PARENT_EVENT");
    expect(await prisma.policyEvaluation.count({ where: { organizationId: orgA.id } })).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §4 SQL backfill parity — the migration's SQL normalizer must equal normalizeKey()
// ---------------------------------------------------------------------------

describe("toolKey backfill parity", () => {
  it("the SQL expression in the P1 migration produces exactly normalizeKey() for tricky inputs", async () => {
    const inputs = ["CRM", "  Zendesk  API ", "zendesk_api", "Api.Stripe", "!!!", "a--b", "-lead-", "Ünïcode Tool", "tab\tseparated", `${"x".repeat(59)} y`];
    for (const input of inputs) {
      const rows = await prisma.$queryRaw<{ key: string | null }[]>(Prisma.sql`
        SELECT NULLIF(btrim(left(btrim(regexp_replace(regexp_replace(lower(btrim(${input})), '[^a-z0-9._-]+', '-', 'g'), '-{2,}', '-', 'g'), '-'), 60), '-'), '') AS key`);
      expect(rows[0].key).toBe(normalizeKey(input));
    }
  });
});
