/**
 * P4 — unified risk engine (shadow mode), end to end against the verified
 * disposable test database (lib/testing/test-db-guard.ts) through the real
 * evaluateAgentAction() path: the explanation is stored with the evaluation,
 * the actual decision is never changed by it, missing context and failures are
 * handled, and no tenant's evidence reaches another tenant's assessment.
 *
 * Evidence tables are append-only: rows are created with the desired values,
 * never updated. Each test uses its own agent because after-response work
 * (behavior, trust) legitimately rewrites an agent's trust state.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Agent, Prisma, TrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { setAgentControlState } from "@/lib/agents/control";
import { resolveApproval } from "@/lib/approvals/service";
import { drainDeferredTasks } from "@/lib/server/defer";
import { buildProfile, type CategoricalRow } from "@/lib/behavior/profile";
import { startOfUtcDay } from "@/lib/behavior/rollup";
import { loadRiskContext } from "@/lib/risk/context";
import type { RiskAssessment } from "@/lib/risk/types";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

const RUN_ID = `test_p4_${Date.now()}`;
const DAY = 86_400_000;
const today = startOfUtcDay(new Date());
const USUAL_HOST = "api.crm.example.com";

let orgA: { id: string };
let orgB: { id: string };
let user: { id: string };
let seq = 0;

async function makeAgent(
  organizationId: string,
  options: { baseline?: boolean; trust?: TrustState; permissions?: { action: string; decision: "ALLOW" | "REQUIRE_APPROVAL" }[] } = {}
): Promise<Agent> {
  seq += 1;
  const agent = await prisma.agent.create({
    data: {
      organizationId,
      name: `p4-agent-${seq}`,
      slug: `p4-agent-${seq}`,
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "m",
      createdAt: new Date(Date.now() - 40 * DAY),
    },
  });
  await prisma.agentPermission.createMany({
    data: (options.permissions ?? [
      { action: "crm.read", decision: "ALLOW" },
      { action: "crm.export", decision: "ALLOW" },
      { action: "refund.issue", decision: "REQUIRE_APPROVAL" },
    ]).map((p) => ({ organizationId, agentId: agent.id, action: p.action, resource: "", decision: p.decision })),
  });
  if (options.baseline) await giveBaseline(agent);
  if (options.trust) await giveTrust(agent, options.trust);
  return agent;
}

const row = (dimension: string, key: string, count: number): CategoricalRow => ({
  dimension,
  key,
  count,
  daysSeen: 15,
  firstSeen: new Date(today.getTime() - 20 * DAY),
  lastSeen: new Date(today.getTime() - DAY),
});

/** A HIGH-confidence ESTABLISHED baseline: one usual destination/tool/data class, ~10 records per event, active in every hour of day. */
async function giveBaseline(agent: Agent) {
  const windowStart = new Date(today.getTime() - 28 * DAY);
  const hourlyTotals = [];
  for (let d = 1; d <= 15; d += 1) {
    for (let h = 0; h < 24; h += 1) hourlyTotals.push({ hourStart: new Date(today.getTime() - d * DAY + h * 3_600_000), count: 1 });
  }
  const built = buildProfile({
    windowStart,
    windowEnd: today,
    categorical: [
      row("destination", USUAL_HOST, 360),
      row("tool", "crm", 360),
      row("service", "crm-api", 360),
      row("eventType", "ACTION", 360),
      row("dataClass", "INTERNAL", 360),
    ],
    hourlyTotals,
    excludedHours: new Set(),
    recordCounts: Array.from({ length: 30 }, () => 10),
    byteCounts: [],
  });
  await prisma.agentBaseline.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      version: 1,
      methodologyVersion: 1,
      maturity: "ESTABLISHED",
      windowStart,
      windowEnd: today,
      eventsObserved: built.eventsObserved,
      activeDays: built.activeDays,
      activeHours: built.activeHours,
      profile: built.profile as unknown as Prisma.InputJsonValue,
    },
  });
}

async function giveTrust(agent: Agent, state: TrustState) {
  await prisma.agentTrustState.create({
    data: {
      agentId: agent.id,
      organizationId: agent.organizationId,
      state,
      score: state === "TRUSTED" ? 95 : 52,
      stateSince: new Date(),
      sequence: 1,
      methodologyVersion: 1,
      factors: [{ key: "k", category: "behavior", code: "behavior.new_destination", points: 8, summary: "New destination seen", at: new Date().toISOString(), evidence: [] }],
      limits: [],
      categories: { totals: [], omittedFactors: 0, evidenceScore: 52 },
      evaluatedAt: new Date(),
    },
  });
}

async function evaluate(agent: Agent, overrides: Partial<PolicyEvaluationInput> = {}) {
  const result = await evaluateAgentAction({
    organizationId: agent.organizationId,
    agentId: agent.id,
    action: "crm.read",
    contextSource: "agent",
    telemetry: { service: "crm-api", destination: { destination: USUAL_HOST, kind: "HOST" }, dataClasses: ["INTERNAL"], recordCount: 10 },
    tool: "CRM",
    ...overrides,
  });
  await drainDeferredTasks();
  const stored = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId } });
  return { result, stored, risk: stored.riskAssessment as unknown as RiskAssessment | null };
}

const RISKY = {
  telemetry: { service: "crm-api", destination: { destination: "files.unknown.example", kind: "HOST" as const }, dataClasses: ["PII" as const], recordCount: 80 },
};

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P4 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P4 B", slug: `${RUN_ID}-b` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "P4 Operator" } });
});

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
});

describe("low risk", () => {
  it("normal behavior from a trusted, established agent: LOW, no reasons, shadow agrees, stored with the evaluation", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const { result, stored, risk } = await evaluate(agent);

    expect(result.decision).toBe("ALLOW");
    expect(risk).not.toBeNull();
    expect(risk!.level).toBe("LOW");
    expect(risk!.reasons).toEqual([]);
    expect(risk!.context.baseline).toMatchObject({ status: "used", version: 1, maturity: "ESTABLISHED" });
    expect(risk!.context.trust).toMatchObject({ status: "used", state: "TRUSTED" });
    expect(risk!.shadow).toMatchObject({ actual: "ALLOW", recommended: "ALLOW", outcome: "AGREES" });
    // The queryable columns mirror the stored explanation (one record, no second table).
    expect(stored.riskAssessedLevel).toBe("LOW");
    expect(stored.riskRecommendedDecision).toBe("ALLOW");
    expect(stored.riskShadowOutcome).toBe("AGREES");
    expect(result.riskAssessment?.level).toBe("LOW");
  });
});

describe("shadow decision: the explanation is advisory and never changes enforcement", () => {
  it("new destination + sensitive data + ~8× volume + degraded trust → HIGH, risk WOULD REQUIRE APPROVAL, but the action is still ALLOWed", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "DEGRADED" });
    const { result, stored, risk } = await evaluate(agent, { action: "crm.export", ...RISKY });

    // Enforcement is exactly what policy decided.
    expect(result.decision).toBe("ALLOW");
    expect(result.decisionSource).toBe("POLICY");
    expect(result.approvalRequestId).toBeUndefined();
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(0);

    expect(risk!.level).toBe("HIGH");
    expect(risk!.escalation.applied).toBe(true);
    const codes = risk!.reasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["new_destination", "sensitive_data", "unusual_volume", "trust_degradation"]));
    const destination = risk!.reasons.find((r) => r.code === "new_destination")!;
    expect(destination.summary).toContain("files.unknown.example");
    expect(destination.evidence[0].detail).toMatchObject({ kind: "NEW_DESTINATION", baselineVersion: 1, baselineMaturity: "ESTABLISHED" });
    expect(risk!.reasons.find((r) => r.code === "unusual_volume")!.summary).toContain("8×");
    expect(risk!.reasons.find((r) => r.code === "trust_degradation")!.evidence[0].detail).toMatchObject({ state: "DEGRADED" });
    expect(risk!.shadow).toMatchObject({
      actual: "ALLOW",
      recommended: "REQUIRE_APPROVAL",
      outcome: "WOULD_ESCALATE",
      summary: "Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL.",
    });
    expect(stored.decision).toBe("ALLOW");
    expect(stored.riskShadowOutcome).toBe("WOULD_ESCALATE");
    expect(stored.riskRecommendedDecision).toBe("REQUIRE_APPROVAL");
  });

  it("the same risky request against the same policy yields the same decision with or without prior risk evidence", async () => {
    const calm = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const noEvidence = await makeAgent(orgA.id);
    const a = await evaluate(calm, { action: "crm.export", ...RISKY });
    const b = await evaluate(noEvidence, { action: "crm.export", ...RISKY });
    expect(a.result.decision).toBe(b.result.decision);
    expect(a.result.decisionSource).toBe(b.result.decisionSource);
    expect(a.risk!.level).not.toBe(b.risk!.level); // the explanation differs; the decision does not
  });

  it("the stored explanation is append-only like the rest of the decision record", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true });
    const { stored } = await evaluate(agent);
    await expect(
      prisma.policyEvaluation.update({ where: { id: stored.id }, data: { riskAssessedLevel: "CRITICAL" } })
    ).rejects.toThrow(/append-only/);
  });
});

describe("policy interaction", () => {
  it("an ALERT policy is a policy_violation reason and the shadow agrees with the actual ALERT", async () => {
    const agent = await makeAgent(orgA.id);
    const policy = await prisma.policy.create({
      data: { organizationId: orgA.id, agentId: agent.id, name: "Watch crm reads", decision: "ALERT", severity: "MEDIUM", action: "crm.read" },
    });
    const { result, risk } = await evaluate(agent);
    expect(result.decision).toBe("ALERT");
    const violation = risk!.reasons.find((r) => r.code === "policy_violation")!;
    expect(violation).toMatchObject({ family: "policy", severity: "MEDIUM" });
    expect(violation.evidence[0]).toMatchObject({ source: "policy", ref: policy.id });
    expect(risk!.level).toBe("MEDIUM");
    expect(risk!.shadow).toMatchObject({ actual: "ALERT", recommended: "ALERT", outcome: "AGREES" });
  });

  it("an explicit policy BLOCK is already stricter than the risk engine: ACTUAL_STRICTER, never weaker", async () => {
    const agent = await makeAgent(orgA.id);
    await prisma.policy.create({ data: { organizationId: orgA.id, agentId: agent.id, name: "No crm reads", decision: "BLOCK", action: "crm.read" } });
    const { result, risk } = await evaluate(agent);
    expect(result.decision).toBe("BLOCK");
    expect(risk!.shadow.recommended).toBe("BLOCK");
    expect(["AGREES", "ACTUAL_STRICTER"]).toContain(risk!.shadow.outcome);
    expect(risk!.reasons.map((r) => r.code)).toContain("policy_violation");
  });

  it("default-deny (no rule matched) is not reported as a policy violation", async () => {
    const agent = await makeAgent(orgA.id);
    const { result, risk } = await evaluate(agent, { action: "unlisted.action" });
    expect(result.decision).toBe("BLOCK");
    expect(result.decisionSource).toBe("DEFAULT_DENY");
    expect(risk!.reasons.map((r) => r.code)).not.toContain("policy_violation");
    expect(risk!.shadow.recommended).toBe("BLOCK");
  });

  it("the kill switch decision is recorded as actual BLOCK and the recommendation is never weaker", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    await setAgentControlState(orgA.id, agent.slug, "STOPPED", user.id, "incident drill");
    const { result, risk } = await evaluate(agent);
    expect(result.decisionSource).toBe("CONTROL");
    expect(risk!.shadow.actual).toBe("BLOCK");
    expect(risk!.shadow.recommended).toBe("BLOCK");
  });
});

describe("conflicting signals: a consumed human approval", () => {
  it("keeps the HIGH level and reasons visible but does not second-guess a human who approved this exact request", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true, trust: "DEGRADED" });
    const request = { action: "refund.issue", ...RISKY };

    const first = await evaluate(agent, request);
    expect(first.result.decision).toBe("REQUIRE_APPROVAL");
    expect(first.risk!.level).toBe("HIGH");
    // Risk and policy agree here.
    expect(first.risk!.shadow).toMatchObject({ recommended: "REQUIRE_APPROVAL", outcome: "AGREES" });

    await resolveApproval(orgA.id, first.result.approvalRequestId!, user.id, "APPROVED");
    const second = await evaluate(agent, { ...request, approvalRequestId: first.result.approvalRequestId });
    expect(second.result.decision).toBe("ALLOW");
    expect(second.result.decisionSource).toBe("APPROVAL");
    expect(second.risk!.level).toBe("HIGH");
    expect(second.risk!.reasons.length).toBeGreaterThan(0);
    expect(second.risk!.shadow).toMatchObject({ actual: "ALLOW", recommended: "ALLOW", suppressedBy: "HUMAN_APPROVAL", outcome: "SUPPRESSED" });
    expect(second.stored.riskShadowOutcome).toBe("SUPPRESSED");
  });
});

describe("missing context", () => {
  it("a brand-new agent with no baseline or trust gets an assessment that says what it could not know", async () => {
    const agent = await makeAgent(orgA.id);
    const { result, risk } = await evaluate(agent, { telemetry: { service: "crm-api" } });
    expect(result.decision).toBe("ALLOW");
    expect(risk!.level).toBe("LOW");
    expect(risk!.context.baseline.status).toBe("unavailable");
    const notes = risk!.context.notes.map((n) => n.code);
    expect(notes).toEqual(expect.arrayContaining(["baseline_unavailable", "trust_unavailable", "data_classification_not_reported"]));
    expect(risk!.reasons).toEqual([]);
  });
});

describe("historical incidents", () => {
  it("repeated prior blocks/alerts of the same action are a history reason; other actions, kill-switch refusals and old rows are not", async () => {
    const agent = await makeAgent(orgA.id);
    const mk = (data: { action: string; decision: "BLOCK" | "ALERT"; decisionSource?: string; ageDays?: number }) =>
      prisma.policyEvaluation.create({
        data: {
          organizationId: orgA.id,
          agentId: agent.id,
          action: data.action,
          decision: data.decision,
          reason: "test",
          decisionSource: data.decisionSource ?? "POLICY",
          createdAt: new Date(Date.now() - (data.ageDays ?? 1) * DAY),
        },
      });
    const e1 = await mk({ action: "crm.read", decision: "BLOCK" });
    const e2 = await mk({ action: "crm.read", decision: "ALERT", ageDays: 2 });
    await mk({ action: "crm.read", decision: "BLOCK", decisionSource: "CONTROL" });
    await mk({ action: "crm.read", decision: "BLOCK", ageDays: 30 });
    await mk({ action: "other.action", decision: "BLOCK" });

    const { risk } = await evaluate(agent);
    const incident = risk!.reasons.find((r) => r.code === "historical_incident")!;
    expect(incident.severity).toBe("MEDIUM");
    expect(incident.evidence.map((e) => e.ref).sort()).toEqual([e1.id, e2.id].sort());
    expect(incident.summary).toContain("2 times");
  });
});

describe("tenant isolation", () => {
  it("another tenant's baseline, trust, incidents and approvals never reach this tenant's assessment", async () => {
    // Org B's agent: restricted, with a baseline and a pile of incidents for the SAME action name.
    const agentB = await makeAgent(orgB.id, { baseline: true, trust: "RESTRICTED" });
    for (let i = 0; i < 3; i += 1) {
      await prisma.policyEvaluation.create({
        data: { organizationId: orgB.id, agentId: agentB.id, action: "crm.read", decision: "BLOCK", reason: "test", decisionSource: "POLICY" },
      });
    }

    // Reading org B's agent through org A's tenant context yields nothing — in either direction.
    const crossAB = await loadRiskContext({
      organizationId: orgA.id,
      agentId: agentB.id,
      action: "crm.read",
      eventType: "ACTION",
      toolKey: "crm",
      service: "crm-api",
      destination: "files.unknown.example",
      dataClasses: ["PII"],
      endUserHash: null,
      recordCount: 80,
      byteCount: null,
      parentEventId: null,
      now: new Date(),
    });
    expect(crossAB).toEqual({ baseline: null, deviations: [], trust: null, incidents: [], incidentsTruncated: false });

    const agentA = await makeAgent(orgA.id, { baseline: true, trust: "TRUSTED" });
    const crossBA = await loadRiskContext({
      organizationId: orgB.id,
      agentId: agentA.id,
      action: "crm.read",
      eventType: "ACTION",
      toolKey: null,
      service: null,
      destination: null,
      dataClasses: [],
      endUserHash: null,
      recordCount: null,
      byteCount: null,
      parentEventId: null,
      now: new Date(),
    });
    expect(crossBA).toEqual({ baseline: null, deviations: [], trust: null, incidents: [], incidentsTruncated: false });

    // And org A's own evaluation of the same action is unaffected by org B's history.
    const { risk } = await evaluate(agentA);
    expect(risk!.level).toBe("LOW");
    expect(risk!.reasons).toEqual([]);
    expect(risk!.context.trust).toMatchObject({ state: "TRUSTED" });
  });

  it("a stored assessment is only readable through the owning organization's evaluation lookup", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true });
    const { stored } = await evaluate(agent);
    const { getPolicyEvaluation } = await import("@/lib/policies/repository");
    expect((await getPolicyEvaluation(orgA.id, stored.id))?.riskAssessment).toBeTruthy();
    expect(await getPolicyEvaluation(orgB.id, stored.id)).toBeNull();
  });
});

describe("failure isolation", () => {
  it("if the evidence lookup fails, the decision is still made and recorded — just without an assessment", async () => {
    const agent = await makeAgent(orgA.id, { baseline: true });
    const spy = vi.spyOn(prisma.agentTrustState, "findFirst").mockRejectedValueOnce(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, stored, risk } = await evaluate(agent);
    spy.mockRestore();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("risk_context_failed"));
    log.mockRestore();

    expect(result.decision).toBe("ALLOW");
    expect(stored.decision).toBe("ALLOW");
    expect(risk).toBeNull();
    expect(stored.riskAssessedLevel).toBeNull();
    expect(stored.riskShadowOutcome).toBeNull();
  });
});
