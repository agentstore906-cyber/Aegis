/**
 * The core Aegis story, end to end, against the real dev database:
 * organization + agent exist -> a policy says "refund > $500 requires
 * approval" -> an agent action is evaluated -> Aegis returns
 * REQUIRE_APPROVAL and creates a real ApprovalRequest -> an Owner
 * approves it -> the decision is recorded -> the full chain is visible
 * in the append-only audit trail by traceId.
 *
 * Drives the actual functions every Server Action/route handler calls
 * (evaluateAgentAction, createPolicy, resolveApproval) — not
 * reimplemented logic — matching every other integration test's
 * Prisma-seeded-fixture convention in this codebase (see
 * app/api/v1/__tests__/routes.integration.test.ts for the same shape).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { createPolicy, createAgentPermission, getPolicyEvaluationsByTraceId } from "@/lib/policies/repository";
import { resolveApproval } from "@/lib/approvals/service";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let owner: { id: string };
let agent: { id: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "E2E Core Flow Org", slug: `${RUN_ID}-e2e-core`, plan: "growth" } });
  owner = await prisma.user.create({ data: { email: `${RUN_ID}-owner@example.com`, name: "E2E Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: "OWNER" } });
  agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      name: "Finance Agent",
      slug: `finance-agent-${RUN_ID}`,
      owner: "Finance team",
      environment: "PRODUCTION",
      modelProvider: "OpenAI",
      modelName: "gpt-4.1",
      riskLevel: "HIGH",
      status: "ACTIVE",
    },
  });

  // Baseline: refunds are allowed at all — the policy below layers a
  // stricter rule on top for large ones, matching the real two-layer
  // "permission + policy" architecture (see docs/policy-engine.md)
  // instead of relying on the engine's fail-closed default.
  await createAgentPermission(org.id, agent.id, {
    action: "refund.issue",
    resource: "",
    decision: "ALLOW",
  });

  await createPolicy(org.id, owner.id, {
    name: "Large refunds require approval",
    status: "ACTIVE",
    priority: 10,
    decision: "REQUIRE_APPROVAL",
    agentId: agent.id,
    action: "refund.issue",
    conditions: [{ field: "context.amount", operator: "GREATER_THAN", value: 500 }],
  });
});

afterAll(async () => {
  // SecurityAlert.agent is onDelete: Restrict (Phase 6 — alerts must
  // never silently disappear if an agent is deleted), so any alerts the
  // detectors created during this test's evaluations must be cleared
  // before the agent itself can be deleted.
  await prisma.securityAlert.deleteMany({ where: { organizationId: org.id } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: org.id } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: org.id } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: org.id } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: org.id } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: org.id } });
  await prisma.policyCondition.deleteMany({ where: { policy: { organizationId: org.id } } });
  await prisma.policy.deleteMany({ where: { organizationId: org.id } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: org.id } });
  await prisma.agent.deleteMany({ where: { organizationId: org.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("the core Aegis flow", () => {
  it("evaluates a $1,250 refund as REQUIRE_APPROVAL and creates a pending approval", async () => {
    const result = await evaluateAgentAction({
      organizationId: org.id,
      agentId: agent.id,
      action: "refund.issue",
      context: { amount: 1250, customer: "Acme Inc." },
    });

    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.approvalRequestId).toBeDefined();

    const request = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalRequestId! },
    });
    expect(request.status).toBe("PENDING");
    expect(request.action).toBe("refund.issue");

    // An Owner approves it — exactly the "SDK polls, receives APPROVED" story.
    const resolved = await resolveApproval(org.id, result.approvalRequestId!, owner.id, "APPROVED");
    expect(resolved.status).toBe("APPROVED");
    expect(resolved.decisions[0]?.decision).toBe("APPROVED");
    expect(resolved.decisions[0]?.decidedBy?.id).toBe(owner.id);

    // Activity shows the action: the original evaluation event plus the
    // post-approval "allowed" event resolveApproval records.
    const activity = await prisma.activityEvent.findMany({
      where: { organizationId: org.id, traceId: result.traceId },
      orderBy: { timestamp: "asc" },
    });
    expect(activity.length).toBeGreaterThanOrEqual(2);
    expect(activity[0].status).toBe("APPROVAL_REQUIRED");
    expect(activity[activity.length - 1].status).toBe("ALLOWED");

    // The audit trail contains the full chain for this trace: the
    // evaluation requesting approval, and the approval being granted.
    const auditEvents = await prisma.auditEvent.findMany({
      where: { organizationId: org.id, traceId: result.traceId },
      orderBy: { createdAt: "asc" },
    });
    const eventTypes = auditEvents.map((e) => e.eventType);
    expect(eventTypes).toContain("approval.requested");
    expect(eventTypes).toContain("approval.approved");

    // Every audit event in this chain is attributable and unambiguous.
    const approvedEvent = auditEvents.find((e) => e.eventType === "approval.approved");
    expect(approvedEvent?.actorUserId).toBe(owner.id);
    expect(approvedEvent?.result).toBe("SUCCESS");

    // The policy evaluation itself is queryable by trace, matching what
    // the Security/Policy Evaluation detail pages show a human.
    const evaluations = await getPolicyEvaluationsByTraceId(org.id, result.traceId);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].decision).toBe("REQUIRE_APPROVAL");
  });

  it("evaluates a $100 refund as ALLOW — the policy's condition correctly excludes it", async () => {
    const result = await evaluateAgentAction({
      organizationId: org.id,
      agentId: agent.id,
      action: "refund.issue",
      context: { amount: 100, customer: "Acme Inc." },
    });

    expect(result.decision).toBe("ALLOW");
    expect(result.approvalRequestId).toBeUndefined();
  });

  it("a second, independent approval can be rejected instead of approved", async () => {
    const result = await evaluateAgentAction({
      organizationId: org.id,
      agentId: agent.id,
      action: "refund.issue",
      context: { amount: 2000 },
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");

    const resolved = await resolveApproval(org.id, result.approvalRequestId!, owner.id, "REJECTED");
    expect(resolved.status).toBe("REJECTED");

    const auditEvents = await prisma.auditEvent.findMany({
      where: { organizationId: org.id, traceId: result.traceId },
    });
    expect(auditEvents.map((e) => e.eventType)).toContain("approval.rejected");
  });
});
