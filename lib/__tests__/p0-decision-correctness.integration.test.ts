/**
 * P0 decision-correctness regression tests, end to end through
 * evaluateAgentAction() and the approval/alert services against a real
 * (verified, disposable — see lib/testing/test-db-guard.ts) Postgres test
 * database. Each section maps to a numbered item in
 * docs/AEGIS_P0_IMPLEMENTATION.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "@prisma/client";

import { prisma } from "@/lib/db";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { setAgentControlState } from "@/lib/agents/control";
import { resolveApproval } from "@/lib/approvals/service";
import { listApprovalRequests } from "@/lib/approvals/repository";
import { ApprovalExpiredError } from "@/lib/approvals/types";
import { upsertAlertFinding } from "@/lib/security/repository";
import { ingestActivityEvent } from "@/lib/activity/ingest";
import { drainDeferredTasks } from "@/lib/server/defer";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

const RUN_ID = `test_p0_${Date.now()}`;

let org: { id: string };
let legacyOrg: { id: string };
let user: { id: string };
let agent: Agent;
let otherAgent: Agent;
let stagingAgent: Agent;
let legacyAgent: Agent;

async function makeAgent(organizationId: string, slug: string, environment: Agent["environment"] = "PRODUCTION") {
  return prisma.agent.create({
    data: { organizationId, name: slug, slug, owner: "Test", modelProvider: "Anthropic", modelName: "test-model", environment },
  });
}

function evaluate(overrides: Partial<PolicyEvaluationInput> & { agentId: string }) {
  return evaluateAgentAction({ organizationId: org.id, action: "invoice.read", ...overrides });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "P0 Org", slug: `${RUN_ID}-org` } });
  legacyOrg = await prisma.organization.create({
    data: { name: "P0 Legacy Org", slug: `${RUN_ID}-legacy`, legacyPolicyMatching: true },
  });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "P0 Approver" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

  agent = await makeAgent(org.id, "p0-agent");
  otherAgent = await makeAgent(org.id, "p0-other-agent");
  stagingAgent = await makeAgent(org.id, "p0-staging-agent", "STAGING");
  legacyAgent = await makeAgent(legacyOrg.id, "p0-legacy-agent");

  const permissions = (agentId: string, organizationId = org.id) => [
    { organizationId, agentId, action: "invoice.read", resource: "", decision: "ALLOW" as const },
    { organizationId, agentId, action: "payments.*", resource: "", decision: "ALLOW" as const },
    { organizationId, agentId, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" as const },
    { organizationId, agentId, action: "customer.delete", resource: "", decision: "ALLOW" as const },
    { organizationId, agentId, action: "crm.export", resource: "", decision: "ALLOW" as const },
    { organizationId, agentId, action: "credit.issue", resource: "", decision: "ALLOW" as const },
  ];
  await prisma.agentPermission.createMany({
    data: [
      ...permissions(agent.id),
      ...permissions(otherAgent.id),
      ...permissions(stagingAgent.id),
      ...permissions(legacyAgent.id, legacyOrg.id),
    ],
  });

  for (const organizationId of [org.id, legacyOrg.id]) {
    await prisma.policy.create({
      data: { organizationId, name: "No payments in production", decision: "BLOCK", action: "payments.*", environment: "PRODUCTION" },
    });
    await prisma.policy.create({
      data: { organizationId, name: "High-risk deletes need approval", decision: "REQUIRE_APPROVAL", action: "customer.*", riskLevel: "HIGH" },
    });
    await prisma.policy.create({
      data: {
        organizationId,
        name: "Block large credits",
        decision: "BLOCK",
        action: "credit.issue",
        conditions: { create: [{ field: "context.amount", operator: "GREATER_THAN", value: 1000 }] },
      },
    });
  }
});

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [org.id, legacyOrg.id];
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// §1 Kill switch
// ---------------------------------------------------------------------------

describe("§1 kill switch", () => {
  it("RUNNING (ACTIVE) agent → normal evaluation", async () => {
    const result = await evaluate({ agentId: agent.id, action: "invoice.read" });
    expect(result.decision).toBe("ALLOW");
    expect(result.decisionSource).toBe("POLICY");
    expect(result.agentStatus).toBe("ACTIVE");
  });

  it("STOPPED agent → BLOCK, decided by the kill switch, and recorded as such", async () => {
    const stopped = await makeAgent(org.id, "p0-stopped-agent");
    await prisma.agentPermission.create({
      data: { organizationId: org.id, agentId: stopped.id, action: "invoice.read", resource: "", decision: "ALLOW" },
    });
    await setAgentControlState(org.id, stopped.slug, "STOPPED", user.id, "incident drill");

    const result = await evaluate({ agentId: stopped.id, action: "invoice.read" });
    expect(result.decision).toBe("BLOCK");
    expect(result.decisionSource).toBe("CONTROL");
    expect(result.policyDecision).toBe("ALLOW");
    expect(result.reason).toMatch(/is STOPPED/);

    const recorded = await prisma.policyEvaluation.findUniqueOrThrow({
      where: { id: result.evaluationId },
      include: { activityEvent: true },
    });
    expect(recorded.decision).toBe("BLOCK");
    expect(recorded.agentStatus).toBe("STOPPED");
    expect(recorded.decisionSource).toBe("CONTROL");
    expect(recorded.activityEvent?.status).toBe("BLOCKED");

    // Resuming restores normal evaluation.
    await setAgentControlState(org.id, stopped.slug, "ACTIVE", user.id);
    expect((await evaluate({ agentId: stopped.id, action: "invoice.read" })).decision).toBe("ALLOW");
  });

  it("STOPPED cannot be bypassed by an ALLOW permission plus an ALLOW policy, nor turned into an approval request", async () => {
    const stopped = await makeAgent(org.id, "p0-stopped-bypass");
    await prisma.agentPermission.createMany({
      data: [
        { organizationId: org.id, agentId: stopped.id, action: "data.sync", resource: "", decision: "ALLOW" },
        { organizationId: org.id, agentId: stopped.id, action: "refund.issue", resource: "", decision: "REQUIRE_APPROVAL" },
      ],
    });
    await prisma.policy.create({
      data: { organizationId: org.id, agentId: stopped.id, name: "Explicit allow", decision: "ALLOW", action: "data.sync" },
    });
    await prisma.agent.update({ where: { id: stopped.id }, data: { status: "STOPPED" } });

    expect((await evaluate({ agentId: stopped.id, action: "data.sync" })).decision).toBe("BLOCK");

    const refund = await evaluate({ agentId: stopped.id, action: "refund.issue" });
    expect(refund.decision).toBe("BLOCK");
    expect(refund.approvalRequestId).toBeUndefined();
    expect(await prisma.approvalRequest.count({ where: { agentId: stopped.id } })).toBe(0);
  });

  it("PAUSED and ARCHIVED agents are refused too; NEEDS_ATTENTION evaluates normally", async () => {
    for (const status of ["PAUSED", "ARCHIVED"] as const) {
      await prisma.agent.update({ where: { id: otherAgent.id }, data: { status } });
      const result = await evaluate({ agentId: otherAgent.id, action: "invoice.read" });
      expect(result.decision).toBe("BLOCK");
      expect(result.agentStatus).toBe(status);
    }
    await prisma.agent.update({ where: { id: otherAgent.id }, data: { status: "NEEDS_ATTENTION" } });
    expect((await evaluate({ agentId: otherAgent.id, action: "invoice.read" })).decision).toBe("ALLOW");
    await prisma.agent.update({ where: { id: otherAgent.id }, data: { status: "ACTIVE" } });
  });

  it("an event reported by a STOPPED agent raises ACTIVITY_WHILE_HALTED (detection, not a claim of blocking)", async () => {
    const halted = await makeAgent(org.id, "p0-halted-reporter");
    await prisma.agent.update({ where: { id: halted.id }, data: { status: "STOPPED" } });
    const fresh = await prisma.agent.findUniqueOrThrow({ where: { id: halted.id } });

    await ingestActivityEvent(org.id, fresh, { agent: fresh.slug, eventType: "ACTION", action: "refund.issue", status: "SUCCESS", metadata: undefined });
    await ingestActivityEvent(org.id, fresh, { agent: fresh.slug, eventType: "ACTION", action: "refund.retry", status: "BLOCKED", metadata: undefined });
    await drainDeferredTasks();

    const alerts = await prisma.securityAlert.findMany({ where: { agentId: halted.id, type: "ACTIVITY_WHILE_HALTED" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].evidence).toMatchObject({ action: "refund.issue", agentStatus: "STOPPED" });
  });
});

// ---------------------------------------------------------------------------
// §2 Policy field omission bypass
// ---------------------------------------------------------------------------

describe("§2 field-omission bypass", () => {
  it("'BLOCK payments in PRODUCTION' applies when the caller omits environment", async () => {
    const result = await evaluate({ agentId: agent.id, action: "payments.transfer" });
    expect(result.decision).toBe("BLOCK");
    expect(result.effectiveEnvironment).toBe("PRODUCTION");
  });

  it("…and when the caller claims a different environment; the claim is kept as evidence", async () => {
    const result = await evaluate({ agentId: agent.id, action: "payments.transfer", environment: "STAGING" });
    expect(result.decision).toBe("BLOCK");
    const recorded = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId } });
    expect(recorded.environment).toBe("PRODUCTION");
    expect(recorded.claimedEnvironment).toBe("STAGING");
    expect(recorded.matchingMode).toBe("STRICT");
  });

  it("an agent registered as STAGING is (correctly) not caught by the production-only rule", async () => {
    expect((await evaluate({ agentId: stagingAgent.id, action: "payments.transfer" })).decision).toBe("ALLOW");
  });

  it("a caller can't under-declare risk to escape a riskLevel-scoped policy", async () => {
    const result = await evaluate({ agentId: agent.id, action: "customer.delete", riskLevel: "LOW" });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.effectiveRiskLevel).toBe("HIGH");
    const recorded = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId } });
    expect(recorded.claimedRiskLevel).toBe("LOW");
  });

  it("a BLOCK condition can't be dodged by omitting, nulling, or garbling the field", async () => {
    expect((await evaluate({ agentId: agent.id, action: "credit.issue" })).decision).toBe("BLOCK");
    expect((await evaluate({ agentId: agent.id, action: "credit.issue", context: { amount: "lots" } })).decision).toBe("BLOCK");
    expect((await evaluate({ agentId: agent.id, action: "credit.issue", context: { amount: 5000 } })).decision).toBe("BLOCK");
    expect((await evaluate({ agentId: agent.id, action: "credit.issue", context: { amount: 50 } })).decision).toBe("ALLOW");
  });

  it("the dashboard policy tester (operator) may still simulate an environment explicitly", async () => {
    const result = await evaluate({ agentId: agent.id, action: "payments.transfer", environment: "STAGING", contextSource: "operator" });
    expect(result.decision).toBe("ALLOW");
  });

  it("LEGACY opt-out orgs keep the pre-P0 behavior, and the evaluation says so", async () => {
    const result = await evaluateAgentAction({ organizationId: legacyOrg.id, agentId: legacyAgent.id, action: "payments.transfer" });
    expect(result.decision).toBe("ALLOW");
    expect(result.matchingMode).toBe("LEGACY");
    const recorded = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId } });
    expect(recorded.matchingMode).toBe("LEGACY");
  });

  it("LEGACY never disables the kill switch", async () => {
    await prisma.agent.update({ where: { id: legacyAgent.id }, data: { status: "STOPPED" } });
    const result = await evaluateAgentAction({ organizationId: legacyOrg.id, agentId: legacyAgent.id, action: "invoice.read" });
    expect(result.decision).toBe("BLOCK");
    await prisma.agent.update({ where: { id: legacyAgent.id }, data: { status: "ACTIVE" } });
  });
});

// ---------------------------------------------------------------------------
// §3 / §4 Approval expiry, single-use, execution binding
// ---------------------------------------------------------------------------

describe("§3 approval expiration", () => {
  it("new approval requests get a real deadline and a request fingerprint", async () => {
    const before = Date.now();
    const result = await evaluate({ agentId: agent.id, action: "refund.issue", resource: "order:exp-1", context: { amount: 10 } });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId! } });
    expect(request.expiresAt).not.toBeNull();
    const ttl = request.expiresAt!.getTime() - before;
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5000);
    expect(request.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.approvalExpiresAt?.getTime()).toBe(request.expiresAt!.getTime());
  });

  it("an expired request can't be approved, and listing flips overdue requests to EXPIRED", async () => {
    const result = await evaluate({ agentId: agent.id, action: "refund.issue", resource: "order:exp-2" });
    await prisma.approvalRequest.update({ where: { id: result.approvalRequestId! }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await listApprovalRequests(org.id, { page: 1 });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId! } })).status).toBe("EXPIRED");
    await expect(resolveApproval(org.id, result.approvalRequestId!, user.id, "APPROVED")).rejects.toThrow();
  });

  it("an expired PENDING request is rejected when an agent tries to use it", async () => {
    const result = await evaluate({ agentId: agent.id, action: "refund.issue", resource: "order:exp-3" });
    await prisma.approvalRequest.update({ where: { id: result.approvalRequestId! }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const retry = await evaluate({ agentId: agent.id, action: "refund.issue", resource: "order:exp-3", approvalRequestId: result.approvalRequestId });
    expect(retry.decision).toBe("BLOCK");
    expect(retry.approvalDenialCode).toBe("APPROVAL_EXPIRED");
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId! } })).status).toBe("EXPIRED");
  });

  it("resolveApproval refuses a request past its deadline (ApprovalExpiredError)", async () => {
    const result = await evaluate({ agentId: agent.id, action: "refund.issue", resource: "order:exp-4" });
    await prisma.approvalRequest.update({ where: { id: result.approvalRequestId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resolveApproval(org.id, result.approvalRequestId!, user.id, "APPROVED")).rejects.toBeInstanceOf(ApprovalExpiredError);
  });
});

describe("§4 single-use approval bound to the exact request", () => {
  async function approvedFor(resource: string, context: Record<string, number> = { amount: 250 }) {
    const request = { agentId: agent.id, action: "refund.issue", resource, context };
    const first = await evaluate(request);
    expect(first.decision).toBe("REQUIRE_APPROVAL");
    await resolveApproval(org.id, first.approvalRequestId!, user.id, "APPROVED");
    return { request, approvalRequestId: first.approvalRequestId! };
  }

  it("APPROVED opens an execution window; consuming it yields one ALLOW", async () => {
    const { request, approvalRequestId } = await approvedFor("order:use-1");
    const approved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } });
    expect(approved.executionExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    const consumed = await evaluate({ ...request, approvalRequestId });
    expect(consumed.decision).toBe("ALLOW");
    expect(consumed.decisionSource).toBe("APPROVAL");
    expect(consumed.consumedApprovalRequestId).toBe(approvalRequestId);

    const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } });
    expect(after.consumedAt).not.toBeNull();
    expect(after.consumedByEvaluationId).toBe(consumed.evaluationId);
    expect(await prisma.auditEvent.count({ where: { entityId: approvalRequestId, eventType: "approval.consumed" } })).toBe(1);
  });

  it("replay: the same approval can't authorize a second execution", async () => {
    const { request, approvalRequestId } = await approvedFor("order:use-2");
    expect((await evaluate({ ...request, approvalRequestId })).decision).toBe("ALLOW");
    const replay = await evaluate({ ...request, approvalRequestId });
    expect(replay.decision).toBe("BLOCK");
    expect(replay.approvalDenialCode).toBe("APPROVAL_ALREADY_USED");
  });

  it("an approval can't be used for a different amount, record, or agent — and isn't consumed by the attempt", async () => {
    const { request, approvalRequestId } = await approvedFor("order:use-3");

    const differentAmount = await evaluate({ ...request, context: { amount: 99999 }, approvalRequestId });
    expect(differentAmount.decision).toBe("BLOCK");
    expect(differentAmount.approvalDenialCode).toBe("APPROVAL_REQUEST_MISMATCH");

    const differentRecord = await evaluate({ ...request, resource: "order:other", approvalRequestId });
    expect(differentRecord.approvalDenialCode).toBe("APPROVAL_REQUEST_MISMATCH");

    const differentAgent = await evaluate({ ...request, agentId: otherAgent.id, approvalRequestId });
    expect(differentAgent.decision).toBe("BLOCK");
    expect(differentAgent.approvalDenialCode).toBe("APPROVAL_AGENT_MISMATCH");

    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } })).consumedAt).toBeNull();
    expect((await evaluate({ ...request, approvalRequestId })).decision).toBe("ALLOW");
  });

  it("concurrent consumption: exactly one of many simultaneous attempts is allowed", async () => {
    const { request, approvalRequestId } = await approvedFor("order:race-1");
    const results = await Promise.all(Array.from({ length: 6 }, () => evaluate({ ...request, approvalRequestId })));
    const allowed = results.filter((r) => r.decision === "ALLOW");
    expect(allowed).toHaveLength(1);
    expect(results.filter((r) => r.decision === "BLOCK")).toHaveLength(5);
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } });
    expect(row.consumedByEvaluationId).toBe(allowed[0].evaluationId);
  });

  it("a still-pending approval returns REQUIRE_APPROVAL pointing at the same request, not a duplicate", async () => {
    const request = { agentId: agent.id, action: "refund.issue", resource: "order:pending-1" };
    const first = await evaluate(request);
    const again = await evaluate({ ...request, approvalRequestId: first.approvalRequestId });
    expect(again.decision).toBe("REQUIRE_APPROVAL");
    expect(again.approvalRequestId).toBe(first.approvalRequestId);
    expect(await prisma.approvalRequest.count({ where: { agentId: agent.id, resource: "order:pending-1" } })).toBe(1);
  });

  it("a rejected approval, or one past its execution window, can't be used", async () => {
    const rejectedReq = { agentId: agent.id, action: "refund.issue", resource: "order:rej-1" };
    const rejected = await evaluate(rejectedReq);
    await resolveApproval(org.id, rejected.approvalRequestId!, user.id, "REJECTED");
    expect((await evaluate({ ...rejectedReq, approvalRequestId: rejected.approvalRequestId })).approvalDenialCode).toBe(
      "APPROVAL_REJECTED"
    );

    const { request, approvalRequestId } = await approvedFor("order:window-1");
    await prisma.approvalRequest.update({ where: { id: approvalRequestId }, data: { executionExpiresAt: new Date(Date.now() - 1000) } });
    expect((await evaluate({ ...request, approvalRequestId })).approvalDenialCode).toBe("APPROVAL_EXECUTION_WINDOW_EXPIRED");
  });

  it("historical (pre-P0, unbound) approvals can never authorize an execution", async () => {
    const { request, approvalRequestId } = await approvedFor("order:legacy-1");
    await prisma.approvalRequest.update({ where: { id: approvalRequestId }, data: { requestFingerprint: null } });
    const result = await evaluate({ ...request, approvalRequestId });
    expect(result.decision).toBe("BLOCK");
    expect(result.approvalDenialCode).toBe("APPROVAL_LEGACY_UNBOUND");
  });

  it("the kill switch beats a valid approval, and the approval is left unconsumed", async () => {
    const { request, approvalRequestId } = await approvedFor("order:killed-1");
    await prisma.agent.update({ where: { id: agent.id }, data: { status: "STOPPED" } });
    try {
      const result = await evaluate({ ...request, approvalRequestId });
      expect(result.decision).toBe("BLOCK");
      expect(result.decisionSource).toBe("CONTROL");
      expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequestId } })).consumedAt).toBeNull();
    } finally {
      await prisma.agent.update({ where: { id: agent.id }, data: { status: "ACTIVE" } });
    }
  });
});

// ---------------------------------------------------------------------------
// §5 Alert deduplication preserves evidence
// ---------------------------------------------------------------------------

describe("§5 alert dedup never destroys evidence", () => {
  const finding = (severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", n: number, dedupeKey = "action:crm.export") => ({
    type: "NEW_SENSITIVE_ACTION" as const,
    severity,
    agentId: otherAgent.id,
    title: `Occurrence ${n}`,
    description: `Description ${n}`,
    evidence: { occurrence: n, token: "must-be-redacted" },
    traceId: `${RUN_ID}-trace-${n}`,
    dedupeKey,
  });

  it("keeps every occurrence, the original evidence, and never downgrades severity", async () => {
    const first = await upsertAlertFinding(org.id, finding("CRITICAL", 1));
    const second = await upsertAlertFinding(org.id, finding("HIGH", 2));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.alert.id).toBe(first.alert.id);

    const alert = await prisma.securityAlert.findUniqueOrThrow({
      where: { id: first.alert.id },
      include: { occurrences: { orderBy: { occurredAt: "asc" } } },
    });
    expect(alert.count).toBe(2);
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.title).toBe("Occurrence 1");
    expect(alert.evidence).toMatchObject({ occurrence: 1 });
    expect(alert.traceId).toBe(`${RUN_ID}-trace-1`);
    expect(alert.occurrences.map((o) => (o.evidence as { occurrence: number }).occurrence)).toEqual([1, 2]);
    expect(alert.occurrences.map((o) => o.severity)).toEqual(["CRITICAL", "HIGH"]);
    expect(alert.occurrences[1].traceId).toBe(`${RUN_ID}-trace-2`);
    expect(JSON.stringify(alert.occurrences)).not.toContain("must-be-redacted");
  });

  it("escalates severity when a later occurrence is worse", async () => {
    const first = await upsertAlertFinding(org.id, finding("MEDIUM", 1, "action:escalate"));
    await upsertAlertFinding(org.id, finding("CRITICAL", 2, "action:escalate"));
    expect((await prisma.securityAlert.findUniqueOrThrow({ where: { id: first.alert.id } })).severity).toBe("CRITICAL");
  });

  it("findings with different dedupe keys become separate alerts", async () => {
    const a = await upsertAlertFinding(org.id, finding("HIGH", 1, "action:a"));
    const b = await upsertAlertFinding(org.id, finding("HIGH", 1, "action:b"));
    expect(a.alert.id).not.toBe(b.alert.id);
  });

  it("concurrent identical findings produce one alert with every occurrence counted", async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => upsertAlertFinding(org.id, finding("HIGH", i, "action:concurrent"))));
    const alerts = await prisma.securityAlert.findMany({
      where: { agentId: otherAgent.id, dedupeKey: "action:concurrent" },
      include: { _count: { select: { occurrences: true } } },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(5);
    expect(alerts[0]._count.occurrences).toBe(5);
  });
});
