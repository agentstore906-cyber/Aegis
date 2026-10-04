/**
 * P5 — risk-driven control, end to end against the verified disposable test
 * database through the real evaluateAgentAction() / POST /api/v1/evaluate
 * paths: shadow mode, the three modes, policy precedence, the approval and
 * block paths, the kill switch, emergency disable, retries, idempotency,
 * concurrent decisions, analytics honesty, and tenant isolation.
 *
 * Evidence tables are append-only: rows are created with the desired values,
 * never updated. Each test uses its own agent because after-response work
 * (behavior, trust) legitimately rewrites an agent's trust state.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Agent, PolicyDecision, Prisma, RiskControlMode, TrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { setAgentControlState } from "@/lib/agents/control";
import { resolveApproval } from "@/lib/approvals/service";
import { drainDeferredTasks } from "@/lib/server/defer";
import { buildProfile, type CategoricalRow } from "@/lib/behavior/profile";
import { startOfUtcDay } from "@/lib/behavior/rollup";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { getTrust } from "@/lib/trust/queries";
import { disableRiskControl, getRiskControlSettings, updateRiskControlSettings } from "@/lib/risk/settings";
import { MIN_LABELS_FOR_RATE, getRiskAnalytics, labelRiskDecision, listReviewQueue } from "@/lib/risk/analytics";
import type { RiskControlRecord } from "@/lib/risk/record";
import type { RiskAssessment } from "@/lib/risk/types";
import type { PolicyEvaluationInput } from "@/lib/policies/types";
import { POST as evaluateHandler } from "@/app/api/v1/evaluate/route";

const RUN_ID = `test_p5_${Date.now()}`;
const DAY = 86_400_000;
const today = startOfUtcDay(new Date());
const USUAL_HOST = "api.crm.example.com";
const NEW_HOST = "files.unknown.example";

let orgA: { id: string };
let orgB: { id: string };
let orgC: { id: string };
let user: { id: string };
let seq = 0;

async function configure(organizationId: string, mode: RiskControlMode, mediumAction: PolicyDecision = "ALERT", highAction: PolicyDecision = "REQUIRE_APPROVAL") {
  await prisma.organization.update({ where: { id: organizationId }, data: { riskControlMode: mode, riskMediumAction: mediumAction, riskHighAction: highAction } });
}

async function makeAgent(organizationId: string, options: { baseline?: boolean; trust?: TrustState } = { baseline: true, trust: "TRUSTED" }): Promise<Agent> {
  seq += 1;
  const agent = await prisma.agent.create({
    data: { organizationId, name: `p5-agent-${seq}`, slug: `p5-agent-${seq}`, owner: "Test", modelProvider: "Anthropic", modelName: "m", createdAt: new Date(Date.now() - 40 * DAY) },
  });
  await prisma.agentPermission.createMany({
    data: [
      { action: "crm.read", decision: "ALLOW" as const },
      { action: "crm.export", decision: "ALLOW" as const },
      { action: "refund.issue", decision: "REQUIRE_APPROVAL" as const },
    ].map((p) => ({ organizationId, agentId: agent.id, action: p.action, resource: "", decision: p.decision })),
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

async function giveBaseline(agent: Agent) {
  const windowStart = new Date(today.getTime() - 28 * DAY);
  const hourlyTotals = [];
  for (let d = 1; d <= 15; d += 1) for (let h = 0; h < 24; h += 1) hourlyTotals.push({ hourStart: new Date(today.getTime() - d * DAY + h * 3_600_000), count: 1 });
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
      factors: [],
      limits: [],
      categories: { totals: [], omittedFactors: 0, evidenceScore: 52 },
      evaluatedAt: new Date(),
    },
  });
}

const CALM = { telemetry: { service: "crm-api", destination: { destination: USUAL_HOST, kind: "HOST" as const }, dataClasses: ["INTERNAL" as const], recordCount: 10 } };
/** One MEDIUM signal only: a destination this agent has never used. */
const MEDIUM_REQ = { telemetry: { service: "crm-api", destination: { destination: NEW_HOST, kind: "HOST" as const }, dataClasses: ["INTERNAL" as const], recordCount: 10 } };
/** New destination + PII + ~8x volume: independent families agree → HIGH. */
const HIGH_REQ = { telemetry: { service: "crm-api", destination: { destination: NEW_HOST, kind: "HOST" as const }, dataClasses: ["PII" as const], recordCount: 80 } };

async function evaluate(agent: Agent, overrides: Partial<PolicyEvaluationInput> = {}) {
  const result = await evaluateAgentAction({
    organizationId: agent.organizationId,
    agentId: agent.id,
    action: "crm.export",
    contextSource: "agent",
    tool: "CRM",
    ...CALM,
    ...overrides,
  });
  await drainDeferredTasks();
  const stored = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId }, include: { activityEvent: true } });
  return {
    result,
    stored,
    risk: stored.riskAssessment as unknown as RiskAssessment | null,
    control: stored.riskControl as unknown as RiskControlRecord,
  };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P5 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P5 B", slug: `${RUN_ID}-b` } });
  orgC = await prisma.organization.create({ data: { name: "P5 C", slug: `${RUN_ID}-c` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "P5 Operator" } });
}, 60_000);

afterEach(() => {
  delete process.env.AEGIS_RISK_CONTROL_DISABLED;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id, orgC.id];
  await prisma.riskReviewLabel.deleteMany({ where: { organizationId: { in: orgIds } } });
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
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}, 60_000);

// ---------------------------------------------------------------------------

describe("phase 1 — shadow mode (OBSERVE, the default)", () => {
  it("a new organization starts in OBSERVE with the P4 mapping", async () => {
    expect(await getRiskControlSettings(orgC.id)).toMatchObject({ mode: "OBSERVE", mediumAction: "ALERT", highAction: "REQUIRE_APPROVAL" });
  });

  it("records Actual ALLOW vs Recommended BLOCK without changing the decision, and the record holds everything needed", async () => {
    await configure(orgA.id, "OBSERVE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const { result, stored, risk, control } = await evaluate(agent, HIGH_REQ);

    expect(result.decision).toBe("ALLOW");
    expect(result.decisionSource).toBe("POLICY");
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(0);
    expect(stored.activityEvent?.status).toBe("ALLOWED");

    expect(risk!.shadow).toMatchObject({ actual: "ALLOW", recommended: "BLOCK", outcome: "WOULD_ESCALATE", summary: "Actual: ALLOW. Aegis risk engine: WOULD BLOCK." });
    expect(stored.riskRecommendedDecision).toBe("BLOCK");
    expect(stored.riskControlOutcome).toBe("OBSERVED");
    expect(stored.riskControlMode).toBe("OBSERVE");
    expect(stored.policyDecision).toBe("ALLOW");

    // decision, reason, policy, risk signals, trust state, timestamp, execution identifier
    expect(stored.decision).toBe("ALLOW");
    expect(stored.reason.length).toBeGreaterThan(0);
    expect(stored.matchedPolicyIds).toEqual([]);
    expect(stored.permissionSnapshot).toMatchObject({ action: "crm.export", decision: "ALLOW" });
    expect(control.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["new_destination", "sensitive_data", "unusual_volume"]));
    expect(control.trust).toMatchObject({ state: "TRUSTED", score: 95 });
    expect(new Date(control.decidedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(control).toMatchObject({ configuredMode: "OBSERVE", effectiveMode: "OBSERVE", policyDecision: "ALLOW", finalDecision: "ALLOW", riskLevel: "HIGH", riskDecision: "BLOCK", traceId: stored.traceId });
    expect(result.evaluationId).toBe(stored.id);
    expect(stored.activityEventId).toBeTruthy();
  });
});

describe("phase 2 — configuration", () => {
  it("enabling a mode that changes decisions needs explicit confirmation, and every change is audited with before/after", async () => {
    await configure(orgC.id, "OBSERVE");
    const refused = await updateRiskControlSettings({
      organizationId: orgC.id,
      actorUserId: user.id,
      next: { mode: "ENFORCE", mediumAction: "ALERT", highAction: "BLOCK" },
      confirmedEnforcement: false,
    });
    expect(refused).toMatchObject({ ok: false });
    expect((await getRiskControlSettings(orgC.id))?.mode).toBe("OBSERVE");

    const saved = await updateRiskControlSettings({
      organizationId: orgC.id,
      actorUserId: user.id,
      next: { mode: "ENFORCE", mediumAction: "ALERT", highAction: "BLOCK" },
      confirmedEnforcement: true,
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    const audit = await prisma.auditEvent.findFirst({ where: { organizationId: orgC.id, eventType: "risk_control.config_updated" }, orderBy: { createdAt: "desc" } });
    expect(audit?.metadata).toMatchObject({ before: { mode: "OBSERVE", highAction: "REQUIRE_APPROVAL" }, after: { mode: "ENFORCE", highAction: "BLOCK" } });
    expect(audit?.actorUserId).toBe(user.id);

    // Unchanged save writes nothing new.
    const again = await updateRiskControlSettings({ organizationId: orgC.id, actorUserId: user.id, next: { mode: "ENFORCE", mediumAction: "ALERT", highAction: "BLOCK" }, confirmedEnforcement: true });
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(await prisma.auditEvent.count({ where: { organizationId: orgC.id, eventType: "risk_control.config_updated" } })).toBe(1);
    await configure(orgC.id, "OBSERVE");
  });

  it("rejects nonsensical mappings", async () => {
    for (const next of [
      { mode: "ENFORCE" as const, mediumAction: "BLOCK" as const, highAction: "BLOCK" as const },
      { mode: "ENFORCE" as const, mediumAction: "ALERT" as const, highAction: "ALERT" as const },
      { mode: "ENFORCE" as const, mediumAction: "ALLOW" as const, highAction: "ALLOW" as const },
    ]) {
      expect(await updateRiskControlSettings({ organizationId: orgC.id, actorUserId: user.id, next, confirmedEnforcement: true })).toMatchObject({ ok: false });
    }
  });
});

describe("phase 3 — enforcement", () => {
  it("LOW risk → ALLOW and nothing changes, in ENFORCE", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const { result, control } = await evaluate(agent, { action: "crm.read", ...CALM });
    expect(result.decision).toBe("ALLOW");
    expect(result.decisionSource).toBe("POLICY");
    expect(control).toMatchObject({ outcome: "NO_CHANGE", riskLevel: "LOW", enforcedByRisk: "ALLOW" });
  });

  it("HIGH risk → BLOCK (ENFORCE, high=BLOCK): returned as BLOCK, source RISK, status BLOCKED, audited, no approval, signals not leaked to the agent", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const { result, stored, control } = await evaluate(agent, HIGH_REQ);

    expect(result.decision).toBe("BLOCK");
    expect(result.decisionSource).toBe("RISK");
    expect(result.policyDecision).toBe("ALLOW");
    expect(result.approvalRequestId).toBeUndefined();
    expect(result.reason).toContain("Blocked by Aegis risk control");
    expect(result.reason).not.toContain(NEW_HOST);
    expect(stored.activityEvent?.status).toBe("BLOCKED");
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(0);
    expect(control).toMatchObject({ outcome: "ESCALATED", policyDecision: "ALLOW", finalDecision: "BLOCK", finalSource: "RISK", effectiveMode: "ENFORCE" });
    expect(stored.riskShadowOutcome).toBe("AGREES");

    const audit = await prisma.auditEvent.findFirst({ where: { organizationId: orgA.id, entityId: stored.id, eventType: "risk_control.enforced" } });
    expect(audit?.metadata).toMatchObject({ outcome: "ESCALATED", policyDecision: "ALLOW", finalDecision: "BLOCK", mode: "ENFORCE" });
  });

  it("APPROVAL_REQUIRED never blocks: high=BLOCK is capped to REQUIRE_APPROVAL, and the shadow still shows what ENFORCE would do", async () => {
    await configure(orgA.id, "APPROVAL_REQUIRED", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const { result, risk, control } = await evaluate(agent, HIGH_REQ);
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.decisionSource).toBe("RISK");
    expect(result.approvalRequestId).toBeTruthy();
    expect(control).toMatchObject({ cappedByMode: true, riskDecision: "BLOCK", enforcedByRisk: "REQUIRE_APPROVAL", outcome: "ESCALATED" });
    expect(risk!.shadow).toMatchObject({ actual: "REQUIRE_APPROVAL", recommended: "BLOCK", outcome: "WOULD_ESCALATE" });
  });

  it("MEDIUM risk is configurable: ALLOW, ALERT (with its own RISK_ALERT) or REQUIRE_APPROVAL", async () => {
    const run = async (medium: PolicyDecision) => {
      await configure(orgA.id, "ENFORCE", medium, "BLOCK");
      const agent = await makeAgent(orgA.id);
      return { agent, ...(await evaluate(agent, MEDIUM_REQ)) };
    };

    const allow = await run("ALLOW");
    expect(allow.risk!.level).toBe("MEDIUM");
    expect(allow.result.decision).toBe("ALLOW");
    expect(allow.control.outcome).toBe("NO_CHANGE");

    const alert = await run("ALERT");
    expect(alert.result.decision).toBe("ALERT");
    expect(alert.result.decisionSource).toBe("RISK");
    expect(alert.stored.activityEvent?.status).toBe("WARNING");
    const riskAlert = await prisma.securityAlert.findFirst({ where: { organizationId: orgA.id, agentId: alert.agent.id, type: "RISK_ALERT" } });
    expect(riskAlert).toMatchObject({ type: "RISK_ALERT", severity: "MEDIUM" });
    expect(await prisma.securityAlert.count({ where: { agentId: alert.agent.id, type: "POLICY_ALERT" } })).toBe(0);

    const approval = await run("REQUIRE_APPROVAL");
    expect(approval.result.decision).toBe("REQUIRE_APPROVAL");
    expect(approval.result.approvalRequestId).toBeTruthy();
  });
});

describe("policy precedence", () => {
  it("explicit policy BLOCK stays authoritative: source POLICY, not credited to risk, and an approval id cannot bypass it", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    await prisma.policy.create({ data: { organizationId: orgA.id, agentId: agent.id, name: "No exports", decision: "BLOCK", action: "crm.export" } });

    const calm = await evaluate(agent);
    expect(calm.result).toMatchObject({ decision: "BLOCK", decisionSource: "POLICY" });
    expect(calm.control.outcome).toBe("NO_CHANGE");

    const risky = await evaluate(agent, HIGH_REQ);
    expect(risky.result).toMatchObject({ decision: "BLOCK", decisionSource: "POLICY" });
    expect(risky.control).toMatchObject({ outcome: "NO_CHANGE", policyDecision: "BLOCK" });

    const bypass = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: "does-not-matter" });
    expect(bypass.result).toMatchObject({ decision: "BLOCK", decisionSource: "POLICY" });
    expect(bypass.result.approvalDenialCode).toBeUndefined();
  });

  it("risk never loosens: a policy REQUIRE_APPROVAL stays REQUIRE_APPROVAL at LOW risk, and default-deny stays BLOCK", async () => {
    await configure(orgA.id, "ENFORCE", "ALLOW", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const gated = await evaluate(agent, { action: "refund.issue", ...CALM });
    expect(gated.risk!.level).toBe("LOW");
    expect(gated.result).toMatchObject({ decision: "REQUIRE_APPROVAL", decisionSource: "POLICY" });

    const denied = await evaluate(agent, { action: "unlisted.action", ...CALM });
    expect(denied.result).toMatchObject({ decision: "BLOCK", decisionSource: "DEFAULT_DENY" });
  });

  it("risk can be stricter than a policy REQUIRE_APPROVAL: ENFORCE high=BLOCK blocks", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const { result, control } = await evaluate(agent, { action: "refund.issue", ...HIGH_REQ });
    expect(result).toMatchObject({ decision: "BLOCK", decisionSource: "RISK", policyDecision: "REQUIRE_APPROVAL" });
    expect(control.outcome).toBe("ESCALATED");
  });

  it("an ALERT policy is still a POLICY_ALERT when risk adds nothing", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    await prisma.policy.create({ data: { organizationId: orgA.id, agentId: agent.id, name: "Watch reads", decision: "ALERT", severity: "LOW", action: "crm.read" } });
    const { result } = await evaluate(agent, { action: "crm.read", ...CALM });
    expect(result).toMatchObject({ decision: "ALERT", decisionSource: "POLICY" });
    expect(await prisma.securityAlert.count({ where: { agentId: agent.id, type: "POLICY_ALERT" } })).toBe(1);
  });
});

describe("approval path", () => {
  it("a risk-gated request goes to a human, the approval is honored once, and re-asking never duplicates the request", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);

    const first = await evaluate(agent, HIGH_REQ);
    expect(first.result).toMatchObject({ decision: "REQUIRE_APPROVAL", decisionSource: "RISK" });
    const approvalId = first.result.approvalRequestId!;
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } })).policyEvaluationId).toBe(first.stored.id);

    // Retry while pending: points at the same request, no duplicate.
    const pending = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: approvalId });
    expect(pending.result.decision).toBe("REQUIRE_APPROVAL");
    expect(pending.result.approvalRequestId).toBe(approvalId);
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(1);

    await resolveApproval(orgA.id, approvalId, user.id, "APPROVED");
    const allowed = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: approvalId });
    expect(allowed.result).toMatchObject({ decision: "ALLOW", decisionSource: "APPROVAL", consumedApprovalRequestId: approvalId });
    expect(allowed.control.outcome).toBe("APPROVAL_HONORED");
    expect(allowed.risk!.shadow).toMatchObject({ suppressedBy: "HUMAN_APPROVAL", outcome: "SUPPRESSED" });

    // Single-use: the same approval cannot be spent twice.
    const reused = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: approvalId });
    expect(reused.result.decision).toBe("BLOCK");
    expect(reused.result.approvalDenialCode).toBeTruthy();
  });

  it("an approval for a different request does not unlock a risk gate", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const first = await evaluate(agent, HIGH_REQ);
    await resolveApproval(orgA.id, first.result.approvalRequestId!, user.id, "APPROVED");
    const other = await evaluate(agent, { ...HIGH_REQ, telemetry: { ...HIGH_REQ.telemetry, recordCount: 81 }, approvalRequestId: first.result.approvalRequestId });
    expect(other.result.decision).toBe("BLOCK");
    expect(other.result.decisionSource).toBe("APPROVAL");
  });

  it("a rejected approval keeps the request gated (BLOCK on retry)", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const first = await evaluate(agent, HIGH_REQ);
    await resolveApproval(orgA.id, first.result.approvalRequestId!, user.id, "REJECTED");
    const retry = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: first.result.approvalRequestId });
    expect(retry.result.decision).toBe("BLOCK");
  });
});

describe("kill switch", () => {
  it("stays authoritative in every mode and is recorded as such", async () => {
    await configure(orgA.id, "ENFORCE", "ALLOW", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    await setAgentControlState(orgA.id, agent.slug, "STOPPED", user.id, "drill");
    const { result, control, stored } = await evaluate(agent, HIGH_REQ);
    expect(result).toMatchObject({ decision: "BLOCK", decisionSource: "CONTROL" });
    expect(control.outcome).toBe("KILL_SWITCH");
    expect(stored.riskControlOutcome).toBe("KILL_SWITCH");
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(0);
  });

  it("a stopped agent cannot use an approval to get around it", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const first = await evaluate(agent, HIGH_REQ);
    await resolveApproval(orgA.id, first.result.approvalRequestId!, user.id, "APPROVED");
    await setAgentControlState(orgA.id, agent.slug, "PAUSED", user.id, "drill");
    const retry = await evaluate(agent, { ...HIGH_REQ, approvalRequestId: first.result.approvalRequestId });
    expect(retry.result).toMatchObject({ decision: "BLOCK", decisionSource: "CONTROL" });
  });
});

describe("emergency control without losing evidence", () => {
  it("disabling risk enforcement returns to OBSERVE, keeps every record, and is audited", async () => {
    await configure(orgB.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgB.id);
    const blocked = await evaluate(agent, HIGH_REQ);
    expect(blocked.result.decision).toBe("BLOCK");
    const before = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: blocked.stored.id } });

    expect(await disableRiskControl(orgB.id, user.id)).toMatchObject({ ok: true, changed: true, after: { mode: "OBSERVE", highAction: "BLOCK" } });
    const after = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: blocked.stored.id } });
    expect(after).toEqual(before); // history untouched
    expect(await prisma.auditEvent.count({ where: { organizationId: orgB.id, action: "risk_control.emergency_disable" } })).toBe(1);

    const next = await evaluate(agent, HIGH_REQ);
    expect(next.result.decision).toBe("ALLOW");
    expect(next.control).toMatchObject({ outcome: "OBSERVED", configuredMode: "OBSERVE" });
    expect(next.risk!.shadow.recommended).toBe("BLOCK"); // shadow data keeps flowing

    // Idempotent.
    expect(await disableRiskControl(orgB.id, user.id)).toMatchObject({ ok: true, changed: false });
    await configure(orgB.id, "OBSERVE");
  });

  it("the platform-wide switch forces OBSERVE for an ENFORCE organization and records both modes", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    process.env.AEGIS_RISK_CONTROL_DISABLED = "1";
    const { result, control, stored } = await evaluate(agent, HIGH_REQ);
    expect(result.decision).toBe("ALLOW");
    expect(control).toMatchObject({ configuredMode: "ENFORCE", effectiveMode: "OBSERVE", globallyDisabled: true, outcome: "OBSERVED" });
    expect(stored.riskControlMode).toBe("OBSERVE");
    delete process.env.AEGIS_RISK_CONTROL_DISABLED;
    expect((await evaluate(await makeAgent(orgA.id), HIGH_REQ)).result.decision).toBe("BLOCK");
  });

  it("if the risk evidence cannot be loaded, policy stands and the record says enforcement was UNAVAILABLE", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    vi.spyOn(prisma.agentTrustState, "findFirst").mockRejectedValueOnce(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, control, risk } = await evaluate(agent, HIGH_REQ);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("risk_control_unavailable"));
    expect(result).toMatchObject({ decision: "ALLOW", decisionSource: "POLICY" });
    expect(risk).toBeNull();
    expect(control).toMatchObject({ outcome: "UNAVAILABLE", riskLevel: null, effectiveMode: "ENFORCE" });
  });
});

describe("no feedback loop into trust or history", () => {
  it("a risk-control block is not counted as agent misbehavior in trust or as a historical incident", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const blocked = await evaluate(agent, HIGH_REQ);
    expect(blocked.result).toMatchObject({ decision: "BLOCK", decisionSource: "RISK" });

    await evaluateTrust(orgA.id, agent.id, { trigger: "ON_DEMAND" });
    const trust = await getTrust(orgA.id, agent.id);
    expect(trust!.factors.filter((f) => f.category === "blocked" || f.category === "violations")).toEqual([]);

    const next = await evaluate(agent, HIGH_REQ);
    expect(next.risk!.reasons.map((r) => r.code)).not.toContain("historical_incident");
  });
});

describe("retries, idempotency and concurrency", () => {
  it("an Idempotency-Key replays the same risk-gated response: one evaluation, one approval", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const key = (await createApiKey(orgA.id, null, { name: "idem", environment: "TEST" })).raw;
    const call = async () => {
      const response = await evaluateHandler(
        new Request("http://localhost/api/v1/evaluate", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": `${RUN_ID}-idem-1` },
          body: JSON.stringify({ agent: agent.slug, action: "crm.export", tool: "CRM", service: "crm-api", destination: NEW_HOST, dataClasses: ["PII"], recordCount: 80 }),
        }),
        { params: Promise.resolve<Record<string, string>>({}) }
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const first = await call();
    await drainDeferredTasks();
    const second = await call();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ decision: "REQUIRE_APPROVAL", decisionSource: "RISK" });
    expect(second.body).toEqual(first.body);
    expect(await prisma.policyEvaluation.count({ where: { agentId: agent.id } })).toBe(1);
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id } })).toBe(1);
    // The API response carries the decision and a generic reason, not the signals.
    expect(JSON.stringify(first.body)).not.toContain(NEW_HOST);
    expect(first.body).not.toHaveProperty("riskAssessment");
  });

  it("concurrent identical requests each get the same decision and each is recorded with its own control record", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        evaluateAgentAction({ organizationId: orgA.id, agentId: agent.id, action: "crm.export", contextSource: "agent", tool: "CRM", ...HIGH_REQ })
      )
    );
    await drainDeferredTasks();
    expect(new Set(results.map((r) => r.decision))).toEqual(new Set(["BLOCK"]));
    expect(new Set(results.map((r) => r.evaluationId)).size).toBe(8);
    const rows = await prisma.policyEvaluation.findMany({ where: { agentId: agent.id } });
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.riskControlOutcome === "ESCALATED" && r.riskControl && r.riskAssessment)).toBe(true);
  });

  it("concurrent use of one approved risk-gate approval: exactly one ALLOW, the rest BLOCK", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "REQUIRE_APPROVAL");
    const agent = await makeAgent(orgA.id);
    const first = await evaluate(agent, HIGH_REQ);
    await resolveApproval(orgA.id, first.result.approvalRequestId!, user.id, "APPROVED");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        evaluateAgentAction({
          organizationId: orgA.id,
          agentId: agent.id,
          action: "crm.export",
          contextSource: "agent",
          tool: "CRM",
          ...HIGH_REQ,
          approvalRequestId: first.result.approvalRequestId,
        })
      )
    );
    await drainDeferredTasks();
    expect(results.filter((r) => r.decision === "ALLOW")).toHaveLength(1);
    expect(results.filter((r) => r.decision === "BLOCK")).toHaveLength(5);
    expect(await prisma.approvalRequest.count({ where: { id: first.result.approvalRequestId!, consumedAt: { not: null } } })).toBe(1);
  });

  it("a configuration change takes effect on the next decision and each decision records the mode it used", async () => {
    await configure(orgA.id, "OBSERVE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgA.id);
    const observed = await evaluate(agent, HIGH_REQ);
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const enforced = await evaluate(agent, HIGH_REQ);
    expect(observed.result.decision).toBe("ALLOW");
    expect(enforced.result.decision).toBe("BLOCK");
    expect([observed.stored.riskControlMode, enforced.stored.riskControlMode]).toEqual(["OBSERVE", "ENFORCE"]);
  });
});

describe("shadow analytics", () => {
  it("counts what was recorded: would-have-blocked / approved, enforcement outcomes and top reasons", async () => {
    await configure(orgC.id, "OBSERVE", "ALERT", "BLOCK");
    const agent = await makeAgent(orgC.id);
    await evaluate(agent, HIGH_REQ);
    await evaluate(agent, HIGH_REQ);
    await evaluate(agent, { action: "crm.read", ...CALM });
    await configure(orgC.id, "ENFORCE", "ALERT", "BLOCK");
    await evaluate(await makeAgent(orgC.id), HIGH_REQ);

    const analytics = await getRiskAnalytics(orgC.id);
    expect(analytics.evaluations).toBe(4);
    expect(analytics.assessed).toBe(4);
    expect(analytics.shadow.wouldHaveBlocked).toBe(2);
    expect(analytics.enforcement.observed).toBe(3);
    expect(analytics.enforcement.escalated).toMatchObject({ total: 1, blocked: 1 });
    expect(analytics.byLevel.HIGH).toBe(3);
    expect(analytics.byLevel.LOW).toBe(1);
    const codes = analytics.topReasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["new_destination", "sensitive_data", "unusual_volume"]));
    expect(analytics.topReasons[0].decisions).toBeGreaterThanOrEqual(2);
  });

  it("makes no false-positive claim without labels, and none from a handful of them", async () => {
    const queue = await listReviewQueue(orgC.id);
    expect(queue.length).toBeGreaterThanOrEqual(3);
    expect(queue.every((q) => q.label === null)).toBe(true);

    let analytics = await getRiskAnalytics(orgC.id);
    expect(analytics.review).toMatchObject({ labeled: 0, falsePositiveShareOfReviewed: null });
    expect(analytics.review.note).toMatch(/no ground truth/i);
    expect(analytics.review.reviewable).toBeGreaterThanOrEqual(3);

    expect(await labelRiskDecision({ organizationId: orgC.id, evaluationId: queue[0].evaluationId, reviewerId: user.id, label: "FALSE_POSITIVE" })).toEqual({ ok: true });
    expect(await labelRiskDecision({ organizationId: orgC.id, evaluationId: queue[1].evaluationId, reviewerId: user.id, label: "JUSTIFIED", note: "legit export" })).toEqual({ ok: true });
    analytics = await getRiskAnalytics(orgC.id);
    expect(analytics.review).toMatchObject({ labeled: 2, justified: 1, falsePositive: 1, falsePositiveShareOfReviewed: null });

    // Relabeling replaces; it does not double count. Every label is an audit event.
    await labelRiskDecision({ organizationId: orgC.id, evaluationId: queue[0].evaluationId, reviewerId: user.id, label: "JUSTIFIED" });
    analytics = await getRiskAnalytics(orgC.id);
    expect(analytics.review).toMatchObject({ labeled: 2, justified: 2, falsePositive: 0 });
    expect(await prisma.auditEvent.count({ where: { organizationId: orgC.id, eventType: "risk_control.reviewed" } })).toBe(3);
  });

  it(`reports a share only once ${MIN_LABELS_FOR_RATE} decided labels exist, with its sample size`, async () => {
    const agent = await makeAgent(orgB.id);
    const ids: string[] = [];
    for (let i = 0; i < MIN_LABELS_FOR_RATE; i += 1) {
      const row = await prisma.policyEvaluation.create({
        data: {
          organizationId: orgB.id,
          agentId: agent.id,
          action: "crm.export",
          decision: "ALLOW",
          reason: "synthetic",
          riskAssessedLevel: "HIGH",
          riskShadowOutcome: "WOULD_ESCALATE",
          riskRecommendedDecision: "REQUIRE_APPROVAL",
          riskAssessment: { headline: "HIGH RISK", reasons: [] },
        },
      });
      ids.push(row.id);
    }
    for (const [i, id] of ids.entries()) {
      await labelRiskDecision({ organizationId: orgB.id, evaluationId: id, reviewerId: user.id, label: i < 6 ? "FALSE_POSITIVE" : "JUSTIFIED" });
    }
    const analytics = await getRiskAnalytics(orgB.id);
    expect(analytics.review.falsePositiveShareOfReviewed).toEqual({ value: 6 / MIN_LABELS_FOR_RATE, n: MIN_LABELS_FOR_RATE });
  });
});

describe("tenant isolation", () => {
  it("one organization's mode, history and labels never affect or appear in another's", async () => {
    await configure(orgA.id, "OBSERVE", "ALERT", "REQUIRE_APPROVAL");
    await configure(orgB.id, "ENFORCE", "ALERT", "BLOCK");
    const agentA = await makeAgent(orgA.id);
    const agentB = await makeAgent(orgB.id);
    const a = await evaluate(agentA, HIGH_REQ);
    const b = await evaluate(agentB, HIGH_REQ);
    expect(a.result.decision).toBe("ALLOW");
    expect(b.result.decision).toBe("BLOCK");
    expect(a.control.configuredMode).toBe("OBSERVE");
    expect(b.control.configuredMode).toBe("ENFORCE");

    // Analytics, the review queue and labels are scoped to the caller's organization.
    const queueA = await listReviewQueue(orgA.id, { limit: 100 });
    expect(queueA.map((q) => q.evaluationId)).toContain(a.stored.id);
    expect(queueA.map((q) => q.evaluationId)).not.toContain(b.stored.id);
    expect(await labelRiskDecision({ organizationId: orgA.id, evaluationId: b.stored.id, reviewerId: user.id, label: "FALSE_POSITIVE" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await prisma.riskReviewLabel.count({ where: { evaluationId: b.stored.id } })).toBe(0);
    const analyticsA = await getRiskAnalytics(orgA.id);
    expect(analyticsA.enforcement.escalated.blocked).toBe(
      await prisma.policyEvaluation.count({ where: { organizationId: orgA.id, riskControlOutcome: "ESCALATED", decision: "BLOCK", createdAt: { gte: new Date(analyticsA.since) } } })
    );

    // Changing one organization's configuration leaves the other's alone.
    await updateRiskControlSettings({ organizationId: orgA.id, actorUserId: user.id, next: { mode: "APPROVAL_REQUIRED", mediumAction: "ALERT", highAction: "REQUIRE_APPROVAL" }, confirmedEnforcement: true });
    expect(await getRiskControlSettings(orgB.id)).toMatchObject({ mode: "ENFORCE", highAction: "BLOCK" });
    expect(await prisma.auditEvent.count({ where: { organizationId: orgB.id, eventType: "risk_control.config_updated", action: "risk_control.update" } })).toBe(0);
    await configure(orgA.id, "OBSERVE");
    await configure(orgB.id, "OBSERVE");
  });

  it("an API key from one organization cannot make a decision for another's agent", async () => {
    await configure(orgA.id, "ENFORCE", "ALERT", "BLOCK");
    const agentA = await makeAgent(orgA.id);
    const keyB = (await createApiKey(orgB.id, null, { name: "b", environment: "TEST" })).raw;
    const response = await evaluateHandler(
      new Request("http://localhost/api/v1/evaluate", {
        method: "POST",
        headers: { authorization: `Bearer ${keyB}`, "content-type": "application/json" },
        body: JSON.stringify({ agent: agentA.slug, action: "crm.export" }),
      }),
      { params: Promise.resolve<Record<string, string>>({}) }
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.policyEvaluation.count({ where: { agentId: agentA.id } })).toBe(0);
    await configure(orgA.id, "OBSERVE");
  });
});
