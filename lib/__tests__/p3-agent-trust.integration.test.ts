/**
 * P3 — agent trust, end to end against the verified disposable test database
 * (lib/testing/test-db-guard.ts): initialization, degradation, recovery,
 * repeated incidents, concurrent updates, historical integrity, tenant
 * isolation, and authorization — through the real ingestion, evaluation,
 * approval, alert, and control paths where they feed trust.
 *
 * Exact-number tests create their evidence rows directly (evidence tables
 * are append-only, so rows are created with the desired values, never
 * updated) and pass an explicit `now`; pipeline tests drive the real routes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent, BehavioralDeviationKind, Prisma, SecurityAlertConfidence } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { ensureBaseline } from "@/lib/behavior/baseline";
import { buildProfile } from "@/lib/behavior/profile";
import { startOfUtcDay } from "@/lib/behavior/rollup";
import { setAgentControlState } from "@/lib/agents/control";
import { resolveApproval } from "@/lib/approvals/service";
import { resolveAlert, upsertAlertFinding } from "@/lib/security/repository";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { getTrust, listTrustHistory } from "@/lib/trust/queries";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";
import { GET as trustGet } from "@/app/api/v1/agents/[slug]/trust/route";
import { GET as reasonsGet } from "@/app/api/v1/agents/[slug]/trust/reasons/route";
import { GET as historyGet } from "@/app/api/v1/agents/[slug]/trust/history/route";
import { GET as cronGet } from "@/app/api/internal/behavior/refresh/route";

const RUN_ID = `test_p3_${Date.now()}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const today = startOfUtcDay(new Date());

let orgA: { id: string };
let orgB: { id: string };
let user: { id: string };
const keyPool: string[] = [];
let keyIndex = 0;
let keyB: string;
let keyNoTrustScope: string;
let keyBoundToVolume: string;
const agents: Record<string, Agent> = {};

const nextKey = () => keyPool[keyIndex++ % keyPool.length];
const ctx = { params: Promise.resolve<Record<string, string>>({}) };

async function makeAgent(organizationId: string, slug: string, ageDays = 40) {
  return prisma.agent.create({
    data: { organizationId, name: slug, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m", createdAt: new Date(Date.now() - ageDays * DAY) },
  });
}

/** An ESTABLISHED baseline row, so the history requirement for TRUSTED is met without seeding events. */
async function giveEstablishedBaseline(agent: Agent) {
  await prisma.agentBaseline.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      version: 1,
      methodologyVersion: 1,
      maturity: "ESTABLISHED",
      windowStart: new Date(today.getTime() - 28 * DAY),
      windowEnd: today,
      eventsObserved: 360,
      activeDays: 20,
      activeHours: 180,
      // Well-formed but empty: the real behavior pipeline reads it, and an empty profile makes no claims (every rule needs observations).
      profile: buildProfile({
        windowStart: new Date(today.getTime() - 28 * DAY),
        windowEnd: today,
        categorical: [],
        hourlyTotals: [],
        excludedHours: new Set(),
        recordCounts: [],
        byteCounts: [],
      }).profile as unknown as Prisma.InputJsonValue,
    },
  });
}

async function matureAgent(slug: string, organizationId = orgA.id) {
  const agent = await makeAgent(organizationId, slug);
  await giveEstablishedBaseline(agent);
  agents[slug] = agent;
  return agent;
}

async function addDeviation(
  agent: Agent,
  kind: BehavioralDeviationKind,
  subject: string,
  options: { at?: Date; occurrences?: number; confidence?: SecurityAlertConfidence } = {}
) {
  const at = options.at ?? new Date();
  return prisma.behavioralDeviation.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      kind,
      dedupeKey: subject,
      day: startOfUtcDay(at), // unique per (agent, kind, subject, day)
      baselineVersion: 1,
      maturity: "ESTABLISHED",
      confidence: options.confidence ?? "HIGH",
      observed: {},
      expected: {},
      explanation: "test deviation",
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: options.occurrences ?? 1,
    },
  });
}

async function addDecision(
  agent: Agent,
  decision: "BLOCK" | "ALERT",
  action: string,
  options: { at?: Date; source?: string } = {}
) {
  return prisma.policyEvaluation.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      action,
      decision,
      reason: "test",
      decisionSource: options.source ?? (decision === "BLOCK" ? "DEFAULT_DENY" : "POLICY"),
      createdAt: options.at ?? new Date(),
    },
  });
}

const transitionsOf = (agent: Agent) => prisma.agentTrustTransition.findMany({ where: { agentId: agent.id }, orderBy: { sequence: "asc" } });
const factorsOf = (state: { factors: unknown }) => state.factors as { key: string; code: string; points: number; summary: string; category: string }[];

async function track(agent: Agent, body: Record<string, unknown>) {
  const response = await eventsHandler(
    new Request("http://localhost/api/v1/events", {
      method: "POST",
      headers: { authorization: `Bearer ${nextKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ agent: agent.slug, eventType: "TOOL_CALL", action: "crm.read", ...body }),
    }),
    ctx
  );
  const json = await response.json();
  if (response.status >= 300) throw new Error(`track ${response.status} ${JSON.stringify(json)}`);
  await drainDeferredTasks();
  return json as { id: string };
}

async function evaluateApi(agent: Agent, body: Record<string, unknown>) {
  const response = await evaluateHandler(
    new Request("http://localhost/api/v1/evaluate", {
      method: "POST",
      headers: { authorization: `Bearer ${nextKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ agent: agent.slug, ...body }),
    }),
    ctx
  );
  const json = await response.json();
  await drainDeferredTasks();
  return { status: response.status, ...(json as { decision: string; evaluationId: string; approvalRequestId?: string }) };
}

type Handler = typeof trustGet;
function get(handler: Handler, slug: string, key: string | null, path = "trust", query = "") {
  return handler(
    new Request(`http://localhost/api/v1/agents/${slug}/${path}${query}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }),
    { params: Promise.resolve({ slug }) }
  );
}

/** Regular history so the real behavior pipeline has an ESTABLISHED baseline to compare against. */
async function seedHistory(agent: Agent, days: number) {
  const rows: Prisma.ActivityEventCreateManyInput[] = [];
  for (let d = 1; d <= days; d += 1) {
    for (let h = 9; h <= 17; h += 1) {
      for (const n of [0, 1]) {
        rows.push({
          id: `${agent.id}-${d}-${h}-${n}`,
          organizationId: agent.organizationId,
          agentId: agent.id,
          eventType: "TOOL_CALL",
          action: "crm.read",
          toolName: "CRM",
          toolKey: "crm",
          service: "crm-api",
          destination: "api.crm.example.com",
          destinationKind: "HOST",
          dataClasses: ["INTERNAL"],
          recordCount: 10,
          status: "ALLOWED",
          outcome: "SUCCESS",
          environment: "PRODUCTION",
          timestamp: new Date(today.getTime() - d * DAY + h * HOUR + (n + 1) * 5 * 60_000),
        });
      }
    }
  }
  await prisma.activityEvent.createMany({ data: rows });
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P3 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P3 B", slug: `${RUN_ID}-b` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "P3 Operator" } });

  agents.fresh = await makeAgent(orgA.id, "p3-fresh", 0);
  for (const slug of [
    "p3-episodes",
    "p3-concurrent",
    "p3-integrity",
    "p3-isolation",
    "p3-controlled",
    "p3-alerts",
    "p3-approvals",
    "p3-excluded",
    "p3-decisions",
    "p3-api",
    "p3-cron",
    "volume",
  ]) {
    await matureAgent(slug);
  }
  agents.pipeline = await makeAgent(orgA.id, "p3-pipeline");
  await seedHistory(agents.pipeline, 20);
  agents.young = await makeAgent(orgA.id, "p3-young", 2);
  agents.otherTenant = await makeAgent(orgB.id, "p3-isolation"); // same slug, other tenant
  await giveEstablishedBaseline(agents.otherTenant);

  for (let i = 0; i < 5; i += 1) keyPool.push((await createApiKey(orgA.id, null, { name: `k${i}`, environment: "TEST" })).raw);
  const noScope = await createApiKey(orgA.id, null, { name: "no-trust-scope", environment: "TEST" });
  await prisma.apiKey.update({ where: { id: noScope.apiKey.id }, data: { scopes: ["events:write", "policy:evaluate", "approvals:read", "behavior:read"] } });
  keyNoTrustScope = noScope.raw;
  keyB = (await createApiKey(orgB.id, null, { name: "b", environment: "TEST" })).raw;
  keyBoundToVolume = (await createApiKey(orgA.id, null, { name: "bound", environment: "TEST", agentId: agents.volume.id })).raw;
}, 120_000);

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  // Trust rows cascade with their agent; evidence tables first (FKs), then agents.
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
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("initialization", () => {
  it("a brand-new agent starts NORMAL (capped at 84, with the reason), and the first read records one initializing transition", async () => {
    const trust = await getTrust(orgA.id, agents.fresh.id);
    expect(trust).toMatchObject({ state: "NORMAL", score: 84, evidenceScore: 100, factors: [] });
    expect(trust!.limits[0]).toMatchObject({ code: "INSUFFICIENT_HISTORY", ceiling: 84 });
    expect(trust!.headline).toContain("No negative evidence");

    const history = await transitionsOf(agents.fresh);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ sequence: 1, previousState: null, previousScore: null, newState: "NORMAL", newScore: 84, trigger: "ON_DEMAND" });
    expect(history[0].summary).toContain("Trust initialized as Normal (score 84)");
  });

  it("reading again, or re-evaluating unchanged evidence, records nothing", async () => {
    await getTrust(orgA.id, agents.fresh.id);
    const again = await evaluateTrust(orgA.id, agents.fresh.id, { trigger: "SCHEDULED" });
    expect(again).toMatchObject({ state: "NORMAL", score: 84, recorded: false });
    expect(await prisma.agentTrustTransition.count({ where: { agentId: agents.fresh.id } })).toBe(1);
  });

  it("a mature, clean agent initializes as TRUSTED at 100; a young one with an established baseline stays NORMAL", async () => {
    const mature = await evaluateTrust(orgA.id, agents["p3-episodes"].id, { trigger: "ON_DEMAND" });
    expect(mature).toMatchObject({ state: "TRUSTED", score: 100 });
    await giveEstablishedBaseline(agents.young);
    const young = await getTrust(orgA.id, agents.young.id);
    expect(young).toMatchObject({ state: "NORMAL", score: 84 });
    expect(young!.limits[0].summary).toContain("2 days old");
  });

  it("a deviation on a never-evaluated agent initializes trust from existing evidence (no backfill needed)", async () => {
    const trust = await getTrust(orgA.id, agents["p3-api"].id);
    expect(trust).toMatchObject({ state: "TRUSTED", score: 100 });
  });
});

describe("degradation, recovery, and repeated incidents (exact numbers, explicit clock)", () => {
  const T = new Date(Date.now());

  it("evidence degrades trust with reasons; as it ages out trust recovers step by step; a repeat incident degrades again — all kept as history", async () => {
    const agent = agents["p3-episodes"];

    // 1. clean → TRUSTED 100 (initialized in the previous describe; evaluate again at T is a no-op)
    expect(await evaluateTrust(orgA.id, agent.id, { trigger: "SCHEDULED", now: T })).toMatchObject({ state: "TRUSTED", score: 100, recorded: false });

    // 2. an incident: 3 high-confidence deviations (30) + 4 unpermitted attempts (16) → 54 → DEGRADED
    const [d1] = await Promise.all([
      addDeviation(agent, "NEW_DESTINATION", "destination:evil.example.com", { at: T }),
      addDeviation(agent, "UNUSUAL_VOLUME", "volume:records", { at: T }),
      addDeviation(agent, "UNUSUAL_DATA_TYPE", "dataClass:PII", { at: T }),
    ]);
    for (let i = 0; i < 4; i += 1) await addDecision(agents["p3-episodes"], "BLOCK", "payments.wire", { at: T });
    const degraded = await evaluateTrust(orgA.id, agent.id, { trigger: "ACTIVITY_EVENT", triggerRef: d1.id, now: T });
    expect(degraded).toMatchObject({ state: "DEGRADED", score: 54, recorded: true });
    expect(degraded!.transition).toMatchObject({ sequence: 2, previousState: "TRUSTED", previousScore: 100, newState: "DEGRADED", newScore: 54, trigger: "ACTIVITY_EVENT", triggerRef: d1.id });
    expect(degraded!.transition!.summary).toContain("Trust degraded from Trusted to Degraded (100 → 54) because");
    expect(degraded!.transition!.summary).toContain("New destination: evil.example.com");
    expect(degraded!.transition!.summary).toContain("Attempted payments.wire without a permission (4 attempts)");

    // 3. half the window later the evidence has lost half its weight (46 → 23 points): 77; recovering from DEGRADED to NORMAL needs 65 → NORMAL
    const half = new Date(T.getTime() + 3.5 * DAY);
    const partial = await evaluateTrust(orgA.id, agent.id, { trigger: "SCHEDULED", now: half });
    expect(partial).toMatchObject({ state: "NORMAL", score: 77, recorded: true });
    expect(partial!.transition!.summary).toMatch(/^Trust recovered from Degraded to Normal \(54 → 77\) because these no longer weigh as much:/);

    // 4. a week later it is gone: TRUSTED again — nothing was permanent
    const healed = new Date(T.getTime() + 8 * DAY);
    const recovered = await evaluateTrust(orgA.id, agent.id, { trigger: "SCHEDULED", now: healed });
    expect(recovered).toMatchObject({ state: "TRUSTED", score: 100, recorded: true });

    // 5. the same kind of incident again: degrades again, as its own new row
    for (const [kind, subject] of [
      ["NEW_DESTINATION", "destination:evil.example.com"],
      ["UNUSUAL_VOLUME", "volume:records"],
      ["UNUSUAL_DATA_TYPE", "dataClass:PII"],
    ] as const) {
      await addDeviation(agent, kind, subject, { at: healed });
    }
    for (let i = 0; i < 4; i += 1) await addDecision(agent, "BLOCK", "payments.wire", { at: healed });
    // (the unique key is (agent, kind, key, day): the first incident was on T's day, this one 8 days later)
    const again = await evaluateTrust(orgA.id, agent.id, { trigger: "POLICY_EVALUATION", now: healed });
    expect(again).toMatchObject({ state: "DEGRADED", score: 54, recorded: true });

    // 6. a small drift inside the same state is not a new history row, but the current state keeps up
    const later = new Date(healed.getTime() + 60_000);
    const drift = await evaluateTrust(orgA.id, agent.id, { trigger: "SCHEDULED", now: later });
    expect(drift).toMatchObject({ state: "DEGRADED", recorded: false });

    const history = await transitionsOf(agent);
    expect(history.map((t) => [t.sequence, t.previousState, t.newState, t.previousScore, t.newScore])).toEqual([
      [1, null, "TRUSTED", null, 100],
      [2, "TRUSTED", "DEGRADED", 100, 54],
      [3, "DEGRADED", "NORMAL", 54, 77],
      [4, "NORMAL", "TRUSTED", 77, 100],
      [5, "TRUSTED", "DEGRADED", 100, 54],
    ]);
    // The first incident's explanation is still exactly what it was.
    expect(history[1].summary).toContain("New destination: evil.example.com");
    expect(history[1].occurredAt.toISOString()).toBe(T.toISOString());
  });

  it("the current state row tracks the latest evaluation, with the factors behind it", async () => {
    const row = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents["p3-episodes"].id } });
    expect(row).toMatchObject({ state: "DEGRADED", sequence: 5 });
    expect(factorsOf(row).map((f) => f.code).sort()).toEqual(["BLOCKED_NO_PERMISSION", "NEW_DESTINATION", "UNUSUAL_DATA_TYPE", "UNUSUAL_VOLUME"]);
  });
});

describe("degradation through the real pipeline", () => {
  it("an event to a never-seen destination records a deviation and trust reacts, citing the event", async () => {
    const event = await track(agents.pipeline, { tool: "CRM", service: "crm-api", destination: "evil.example.com", dataClasses: ["INTERNAL"], recordCount: 10 });
    const state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents.pipeline.id } });
    const destination = factorsOf(state).find((f) => f.code === "NEW_DESTINATION");
    expect(destination).toMatchObject({ summary: "New destination: evil.example.com", category: "behavior" });
    expect(destination!.points).toBeGreaterThan(5);

    // Which trigger gets there first is a race (the self-reported action also raises a policy-violation alert,
    // evaluated concurrently); whichever records the destination must be one of the two and say why.
    const history = await transitionsOf(agents.pipeline);
    expect(history[0]).toMatchObject({ sequence: 1, previousState: null });
    const withDestination = history.find((t) => (t.factors as { code: string }[]).some((f) => f.code === "NEW_DESTINATION"))!;
    expect(["ACTIVITY_EVENT", "SECURITY_ALERT"]).toContain(withDestination.trigger);
    if (withDestination.trigger === "ACTIVITY_EVENT") expect(withDestination.triggerRef).toBe(event.id);
    expect(withDestination.summary).toContain("New destination: evil.example.com");
  });

  it("repeating the same deviation weighs more (repeated incident), without inventing a second row of evidence", async () => {
    const before = factorsOf(await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents.pipeline.id } })).find((f) => f.code === "NEW_DESTINATION")!;
    await track(agents.pipeline, { tool: "CRM", service: "crm-api", destination: "evil.example.com", dataClasses: ["INTERNAL"], recordCount: 10 });
    await track(agents.pipeline, { tool: "CRM", service: "crm-api", destination: "evil.example.com", dataClasses: ["INTERNAL"], recordCount: 10 });
    const after = factorsOf(await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents.pipeline.id } })).find((f) => f.code === "NEW_DESTINATION")!;
    expect(after.points).toBeGreaterThan(before.points);
    expect(after.summary).toContain("seen 3×");
    expect(await prisma.behavioralDeviation.count({ where: { agentId: agents.pipeline.id, kind: "NEW_DESTINATION" } })).toBe(1);
  });

  it("a blocked action (no permission) lowers trust and the transition names the evaluation", async () => {
    const result = await evaluateApi(agents.pipeline, { action: "payments.wire" });
    expect(result.decision).toBe("BLOCK");
    const state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents.pipeline.id } });
    expect(factorsOf(state).find((f) => f.code === "BLOCKED_NO_PERMISSION")).toMatchObject({ summary: "Attempted payments.wire without a permission (1 attempt)" });
    expect(state.evaluatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("ordinary allowed activity adds no evidence (an off-hours UNUSUAL_TIME is the only thing that could, depending on the clock)", async () => {
    const codes = async () =>
      factorsOf(await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agents.pipeline.id } }))
        .map((f) => f.key)
        .filter((k) => !k.includes("UNUSUAL_TIME"))
        .sort();
    const before = await codes();
    await track(agents.pipeline, { tool: "CRM", service: "crm-api", destination: "api.crm.example.com", dataClasses: ["INTERNAL"], recordCount: 10 });
    expect(await codes()).toEqual(before);
  });
});

describe("other evidence sources", () => {
  it("a security alert lowers trust; resolving it lets trust recover (a quarter weight remains as history)", async () => {
    const agent = agents["p3-alerts"];
    const { alert } = await upsertAlertFinding(orgA.id, {
      type: "HIGH_RISK_BURST",
      severity: "HIGH",
      agentId: agent.id,
      title: "Burst of risky actions",
      description: "d",
      evidence: {},
      dedupeKey: "t",
    });
    await drainDeferredTasks();
    let state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(state.score).toBe(85);
    expect(factorsOf(state)[0]).toMatchObject({ category: "alerts", code: "HIGH_RISK_BURST" });
    expect(factorsOf(state)[0].points).toBeGreaterThan(14.9);

    await resolveAlert(orgA.id, alert.id, user.id);
    await drainDeferredTasks();
    state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(state.score).toBe(96);
    expect(factorsOf(state)[0].summary).toContain("(resolved)");
    expect(factorsOf(state)[0].points).toBeGreaterThan(3.5);
    expect(factorsOf(state)[0].points).toBeLessThan(4);
  });

  it("a rejected approval lowers trust; an approved one does not", async () => {
    const agent = agents["p3-approvals"];
    await prisma.agentPermission.create({ data: { organizationId: orgA.id, agentId: agent.id, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" } });
    const first = await evaluateApi(agent, { action: "refund.issue", resource: "order:1", context: { amount: 5 } });
    const second = await evaluateApi(agent, { action: "refund.issue", resource: "order:2", context: { amount: 5 } });
    expect(first.decision).toBe("REQUIRE_APPROVAL");

    await resolveApproval(orgA.id, second.approvalRequestId!, user.id, "APPROVED");
    await drainDeferredTasks();
    expect(factorsOf((await prisma.agentTrustState.findUnique({ where: { agentId: agent.id } })) ?? { factors: [] })).toEqual([]);

    await resolveApproval(orgA.id, first.approvalRequestId!, user.id, "REJECTED", "no");
    await drainDeferredTasks();
    const state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(factorsOf(state)).toHaveLength(1);
    expect(factorsOf(state)[0]).toMatchObject({ category: "approvals", summary: "Approval for refund.issue was rejected (1 time)" });
    expect((await transitionsOf(agent)).map((t) => t.trigger)).toContain("APPROVAL_DECISION");
  });

  it("policy ALERT matches count as violations", async () => {
    const agent = agents["p3-decisions"];
    await addDecision(agent, "ALERT", "export.data");
    await addDecision(agent, "ALERT", "export.data");
    const trust = await evaluateTrust(orgA.id, agent.id, { trigger: "POLICY_EVALUATION" });
    expect(trust).toMatchObject({ state: "TRUSTED", score: 90 });
    const state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(factorsOf(state)[0]).toMatchObject({ category: "violations", summary: "Policy violation on export.data (2 times)" });
  });

  it("evidence that isn't the agent's behavior never counts: kill-switch refusals, double-counted alert types, and cost alerts", async () => {
    const agent = agents["p3-excluded"];
    await addDecision(agent, "BLOCK", "invoice.read", { source: "CONTROL" });
    for (const type of ["NEW_TOOL_USAGE", "POLICY_ALERT", "BLOCK_SPIKE", "ACTIVITY_VOLUME_SPIKE", "COST_SPIKE", "BUDGET_EXCEEDED"] as const) {
      await upsertAlertFinding(orgA.id, { type, severity: "CRITICAL", agentId: agent.id, title: type, description: "d", evidence: {}, dedupeKey: type });
    }
    await drainDeferredTasks();
    const trust = await evaluateTrust(orgA.id, agent.id, { trigger: "ON_DEMAND" });
    expect(trust).toMatchObject({ state: "TRUSTED", score: 100 });
    expect((await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } })).factors).toEqual([]);
  });

  it("an operator stop restricts the agent (with the reason) and a resume lifts it; the audit trail records both", async () => {
    const agent = agents["p3-controlled"];
    await evaluateTrust(orgA.id, agent.id, { trigger: "ON_DEMAND" });

    await setAgentControlState(orgA.id, agent.slug, "STOPPED", user.id, "incident drill");
    let state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(state.state).toBe("RESTRICTED");
    let history = await transitionsOf(agent);
    expect(history.at(-1)).toMatchObject({ trigger: "OPERATOR_CONTROL", triggerRef: "ACTIVE>STOPPED", previousState: "TRUSTED", newState: "RESTRICTED" });
    expect(history.at(-1)!.summary).toContain("an operator restricted the agent");

    // The kill switch's own refusals aren't counted against the agent.
    const refused = await evaluateApi(agent, { action: "invoice.read" });
    expect(refused.decision).toBe("BLOCK");
    state = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(factorsOf(state)).toEqual([]);

    await setAgentControlState(orgA.id, agent.slug, "ACTIVE", user.id);
    history = await transitionsOf(agent);
    expect(history.at(-1)).toMatchObject({ trigger: "OPERATOR_CONTROL", previousState: "RESTRICTED", newState: "TRUSTED" });
    expect(history.at(-1)!.summary).toContain("the operator restriction was lifted");

    const audits = await prisma.auditEvent.findMany({ where: { agentId: agent.id, eventType: "agent.trust_changed" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.metadata as { newState: string }).newState)).toEqual(["TRUSTED", "RESTRICTED", "TRUSTED"]);
  });

  it("trust is informational: a DEGRADED agent with an ALLOW permission is still allowed", async () => {
    const agent = agents["p3-decisions"];
    for (const [kind, subject] of [
      ["NEW_DESTINATION", "destination:a"],
      ["UNUSUAL_VOLUME", "volume:records"],
      ["UNUSUAL_DATA_TYPE", "dataClass:PII"],
      ["NEW_TOOL", "tool:t"],
    ] as const) {
      await addDeviation(agent, kind, subject);
    }
    for (let i = 0; i < 4; i += 1) await addDecision(agent, "BLOCK", "x.y");
    await prisma.agentPermission.create({ data: { organizationId: orgA.id, agentId: agent.id, action: "crm.read", resource: "", decision: "ALLOW" } });
    const trust = await evaluateTrust(orgA.id, agent.id, { trigger: "ON_DEMAND" });
    expect(["DEGRADED", "HIGH_RISK"]).toContain(trust!.state);
    expect((await evaluateApi(agent, { action: "crm.read" })).decision).toBe("ALLOW");
  });
});

describe("concurrent updates", () => {
  it("many simultaneous evaluations append one gapless sequence and never duplicate a transition", async () => {
    const agent = agents["p3-concurrent"];
    await addDeviation(agent, "NEW_DESTINATION", "destination:a");
    await addDeviation(agent, "UNUSUAL_VOLUME", "volume:records");
    await addDeviation(agent, "UNUSUAL_DATA_TYPE", "dataClass:PII");

    const first = await Promise.all(Array.from({ length: 12 }, (_, i) => evaluateTrust(orgA.id, agent.id, { trigger: i % 2 ? "SCHEDULED" : "ACTIVITY_EVENT" })));
    expect(first.filter((r) => r!.recorded)).toHaveLength(1);
    expect(new Set(first.map((r) => `${r!.state}:${r!.score}`)).size).toBe(1);
    expect((await transitionsOf(agent)).map((t) => t.sequence)).toEqual([1]);

    // New evidence, another burst of concurrent evaluations: exactly one more row.
    for (let i = 0; i < 6; i += 1) await addDecision(agent, "BLOCK", `act.${i}`);
    const second = await Promise.all(Array.from({ length: 12 }, () => evaluateTrust(orgA.id, agent.id, { trigger: "POLICY_EVALUATION" })));
    expect(second.filter((r) => r!.recorded)).toHaveLength(1);
    const history = await transitionsOf(agent);
    expect(history.map((t) => t.sequence)).toEqual([1, 2]);
    expect(history[1].previousScore).toBe(history[0].newScore);
    expect(await prisma.agentTrustState.count({ where: { agentId: agent.id } })).toBe(1);
  });

  it("the unique (agent, sequence) constraint rejects a duplicate even if the application lock were bypassed", async () => {
    const agent = agents["p3-concurrent"];
    const [first] = await transitionsOf(agent);
    const { id, ...rest } = first;
    void id;
    await expect(
      prisma.agentTrustTransition.create({
        data: { ...rest, factors: [], limits: [], changes: [] },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("historical integrity", () => {
  it("a recorded transition can never be modified, in any column", async () => {
    const agent = agents["p3-integrity"];
    await addDeviation(agent, "NEW_DESTINATION", "destination:a");
    await addDeviation(agent, "UNUSUAL_VOLUME", "volume:records");
    await addDeviation(agent, "UNUSUAL_DATA_TYPE", "dataClass:PII");
    await evaluateTrust(orgA.id, agent.id, { trigger: "ACTIVITY_EVENT" });
    const [t] = await transitionsOf(agent);

    await expect(prisma.agentTrustTransition.update({ where: { id: t.id }, data: { newScore: 100 } })).rejects.toThrow(/append-only/);
    await expect(prisma.agentTrustTransition.update({ where: { id: t.id }, data: { summary: "rewritten" } })).rejects.toThrow(/append-only/);
    await expect(prisma.agentTrustTransition.update({ where: { id: t.id }, data: { factors: [] } })).rejects.toThrow(/append-only/);
    await expect(prisma.agentTrustTransition.update({ where: { id: t.id }, data: { newState: "TRUSTED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.agentTrustTransition.updateMany({ where: { agentId: agent.id }, data: { triggerRef: "x" } })).rejects.toThrow(/append-only/);
    expect(await transitionsOf(agent)).toEqual([t]);
  });

  it("history stays readable and unchanged after the source evidence is gone; recovery is a NEW row, not an edit", async () => {
    const agent = agents["p3-integrity"];
    const [before] = await transitionsOf(agent);
    expect(before.summary).toContain("New destination: a");

    await prisma.behavioralDeviation.deleteMany({ where: { agentId: agent.id } });
    const recovered = await evaluateTrust(orgA.id, agent.id, { trigger: "SCHEDULED" });
    expect(recovered).toMatchObject({ state: "TRUSTED", score: 100, recorded: true });

    const history = await transitionsOf(agent);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(before); // byte-for-byte what was recorded, snapshot of factors included
    expect((history[0].factors as { code: string }[]).map((f) => f.code).sort()).toEqual(["NEW_DESTINATION", "UNUSUAL_DATA_TYPE", "UNUSUAL_VOLUME"]);
    expect(history[1]).toMatchObject({ sequence: 2, previousScore: before.newScore, newScore: 100 });
  });

  it("each transition chains to the previous one: previous state/score always equal the prior row's new state/score", async () => {
    const history = await transitionsOf(agents["p3-episodes"]);
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i].sequence).toBe(history[i - 1].sequence + 1);
      expect(history[i].previousState).toBe(history[i - 1].newState);
      expect(history[i].previousScore).toBe(history[i - 1].newScore);
    }
  });
});

describe("tenant isolation", () => {
  it("another organization's key cannot read an agent it doesn't own — 404, indistinguishable from a missing agent", async () => {
    for (const [handler, path] of [
      [trustGet, "trust"],
      [reasonsGet, "trust/reasons"],
      [historyGet, "trust/history"],
    ] as const) {
      const response = await get(handler, "p3-episodes", keyB, path);
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("AGENT_NOT_FOUND");
    }
  });

  it("the same slug in two tenants resolves to each tenant's own agent and evidence", async () => {
    await addDeviation(agents["p3-isolation"], "NEW_DESTINATION", "destination:only-in-a");
    await evaluateTrust(orgA.id, agents["p3-isolation"].id, { trigger: "ACTIVITY_EVENT" });

    const a = await (await get(reasonsGet, "p3-isolation", nextKey(), "trust/reasons")).json();
    const b = await (await get(reasonsGet, "p3-isolation", keyB, "trust/reasons")).json();
    expect(a.factors.map((f: { summary: string }) => f.summary)).toEqual(["New destination: only-in-a"]);
    expect(b.factors).toEqual([]);
    expect(JSON.stringify(b)).not.toContain("only-in-a");
  });

  it("library functions refuse another tenant's agent id and write nothing", async () => {
    const victim = agents["p3-isolation"];
    const rowsBefore = await prisma.agentTrustTransition.count({ where: { agentId: victim.id } });
    expect(await getTrust(orgB.id, victim.id)).toBeNull();
    expect(await listTrustHistory(orgB.id, victim.id)).toBeNull();
    expect(await evaluateTrust(orgB.id, victim.id, { trigger: "ON_DEMAND" })).toBeNull();
    expect(await prisma.agentTrustTransition.count({ where: { agentId: victim.id } })).toBe(rowsBefore);
    expect(await prisma.agentTrustTransition.count({ where: { organizationId: orgB.id, agentId: victim.id } })).toBe(0);
  });
});

describe("authorization and API", () => {
  it("requires a valid API key", async () => {
    expect((await get(trustGet, "p3-api", null)).status).toBe(401);
    expect((await get(trustGet, "p3-api", "aegis_test_notarealkey")).status).toBe(401);
  });

  it("requires the trust:read scope; keys created before P3 don't have it", async () => {
    for (const [handler, path] of [
      [trustGet, "trust"],
      [reasonsGet, "trust/reasons"],
      [historyGet, "trust/history"],
    ] as const) {
      const response = await get(handler, "p3-api", keyNoTrustScope, path);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    }
    expect((await get(trustGet, "p3-api", nextKey())).status).toBe(200);
  });

  it("an agent-bound key can read only its own agent's trust", async () => {
    const other = await get(trustGet, "p3-api", keyBoundToVolume);
    expect(other.status).toBe(403);
    expect((await other.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
    expect((await get(trustGet, "volume", keyBoundToVolume)).status).toBe(200);
  });

  it("GET /trust: state, score, since, and a one-sentence reason — nothing internal", async () => {
    const body = await (await get(trustGet, "p3-episodes", nextKey())).json();
    expect(body.trust).toMatchObject({ state: "DEGRADED", score: 54, methodologyVersion: 1 });
    expect(Object.keys(body.trust).sort()).toEqual(["evaluatedAt", "headline", "methodologyVersion", "score", "state", "stateSince"]);
    expect(body.trust.headline).toContain("Degraded because of:");
    expect(JSON.stringify(body)).not.toMatch(/organizationId|agentId/);
  });

  it("GET /trust/reasons: every factor with points and evidence ids, the limits, category totals, and the thresholds", async () => {
    const body = await (await get(reasonsGet, "p3-episodes", nextKey(), "trust/reasons")).json();
    expect(body.evidenceScore).toBe(54);
    expect(body.factors.length).toBeGreaterThanOrEqual(4);
    const destination = body.factors.find((f: { code: string }) => f.code === "NEW_DESTINATION");
    expect(destination).toMatchObject({ category: "behavior", points: 10, evidence: [{ type: "behavioral_deviation", id: expect.any(String) }] });
    expect(body.categories.find((c: { category: string }) => c.category === "behavior")).toMatchObject({ applied: 30, cap: 40, capped: false });
    expect(body.thresholds).toEqual([
      { state: "TRUSTED", minScore: 85 },
      { state: "NORMAL", minScore: 60 },
      { state: "DEGRADED", minScore: 40 },
      { state: "HIGH_RISK", minScore: 20 },
      { state: "RESTRICTED", minScore: 0 },
    ]);
    const young = await (await get(reasonsGet, "p3-young", nextKey(), "trust/reasons")).json();
    expect(young.limits[0]).toMatchObject({ code: "INSUFFICIENT_HISTORY", ceiling: 84 });
  });

  it("GET /trust/history: newest first, paged, each row with previous → new, trigger, reason, and the factor snapshot", async () => {
    const page1 = await (await get(historyGet, "p3-episodes", nextKey(), "trust/history", "?limit=2")).json();
    expect(page1.transitions.map((t: { sequence: number }) => t.sequence)).toEqual([5, 4]);
    expect(page1.nextBefore).toBe(4);
    expect(page1.transitions[0]).toMatchObject({
      direction: "degraded",
      previousState: "TRUSTED",
      newState: "DEGRADED",
      previousScore: 100,
      newScore: 54,
      trigger: "POLICY_EVALUATION",
    });
    expect(page1.transitions[0].summary).toContain("Trust degraded");
    expect(page1.transitions[0].factors.length).toBeGreaterThan(0);
    expect(page1.transitions[1].direction).toBe("recovered");

    const page2 = await (await get(historyGet, "p3-episodes", nextKey(), "trust/history", `?limit=10&before=${page1.nextBefore}`)).json();
    expect(page2.transitions.map((t: { sequence: number }) => t.sequence)).toEqual([3, 2, 1]);
    expect(page2.nextBefore).toBeNull();
    expect(page2.transitions.at(-1).direction).toBe("initialized");
  });

  it("rejects malformed paging parameters with 400", async () => {
    for (const query of ["?limit=0", "?limit=abc", "?limit=1000", "?before=-1", "?before=x"]) {
      expect((await get(historyGet, "p3-api", nextKey(), "trust/history", query)).status).toBe(400);
    }
  });

  it("404s for an unknown agent", async () => {
    expect((await get(trustGet, "no-such-agent", nextKey())).status).toBe(404);
  });
});

describe("scheduled maintenance", () => {
  it("the daily cron evaluates agents that never were (and reports counts only)", async () => {
    const agent = agents["p3-cron"];
    expect(await prisma.agentTrustState.findUnique({ where: { agentId: agent.id } })).toBeNull();
    const saved = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "test-cron-secret-value";
      const response = await cronGet(new Request("http://localhost/x", { headers: { authorization: "Bearer test-cron-secret-value" } }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.trust).toEqual(expect.objectContaining({ processed: expect.any(Number), failed: 0 }));
      expect(JSON.stringify(body)).not.toContain("evil");
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
    const row = await prisma.agentTrustState.findUniqueOrThrow({ where: { agentId: agent.id } });
    expect(row.state).toBe("TRUSTED");
    expect((await transitionsOf(agent))[0].trigger).toBe("SCHEDULED");
  });
});

describe("baseline interplay", () => {
  it("trust reads the latest baseline's maturity without computing one (a real baseline on the pipeline agent)", async () => {
    const baseline = await ensureBaseline(orgA.id, agents.pipeline.id);
    expect(baseline.maturity).toBe("ESTABLISHED");
    const trust = await getTrust(orgA.id, agents.pipeline.id, new Date(Date.now() + HOUR));
    expect(trust!.limits.map((l) => l.code)).not.toContain("INSUFFICIENT_HISTORY");
  });
});
