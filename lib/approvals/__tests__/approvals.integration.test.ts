/**
 * Integration test against the real dev database (DATABASE_URL from .env),
 * modeled on lib/policies/__tests__/repository.integration.test.ts. The
 * approval workflow is inherently transaction- and race-condition-bound
 * (double-resolution prevention, lazy expiry), so it's exercised against
 * real Postgres rather than pure functions. Creates its own throwaway
 * orgs/agent/user and cleans them up in a finally-equivalent afterAll
 * regardless of outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { createApprovalRequestForEvaluation, getApprovalRequest } from "@/lib/approvals/repository";
import { resolveApproval } from "@/lib/approvals/service";
import { ApprovalAlreadyResolvedError, ApprovalExpiredError, ApprovalNotFoundError } from "@/lib/approvals/types";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string };
let approver: { id: string };

async function requireApproval(resource: string) {
  const result = await evaluateAgentAction({
    organizationId: orgA.id,
    agentId: agentA.id,
    action: "test.approve",
    resource,
  });
  if (result.decision !== "REQUIRE_APPROVAL" || !result.approvalRequestId) {
    throw new Error(`Expected REQUIRE_APPROVAL with an approval request, got ${result.decision}`);
  }
  return result as typeof result & { approvalRequestId: string };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Approvals Org A", slug: `${RUN_ID}-appr-a` } });
  orgB = await prisma.organization.create({ data: { name: "Approvals Org B", slug: `${RUN_ID}-appr-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Approvals Test Agent",
      slug: "approvals-test-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  approver = await prisma.user.create({
    data: { email: `${RUN_ID}-approver@example.com`, name: "Test Approver" },
  });

  await prisma.agentPermission.create({
    data: {
      organizationId: orgA.id,
      agentId: agentA.id,
      action: "test.approve",
      resource: "",
      decision: "REQUIRE_APPROVAL",
    },
  });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  // SecurityAlert.agent is onDelete: Restrict (Phase 6) — clear any
  // alerts the detectors created during evaluation before deleting agents.
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalDecision.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: approver.id } });
  await prisma.$disconnect();
});

describe("REQUIRE_APPROVAL creates an ApprovalRequest", () => {
  it("evaluateAgentAction creates a PENDING request linked to the evaluation", async () => {
    const result = await requireApproval("creates-request");

    const request = await getApprovalRequest(orgA.id, result.approvalRequestId);
    expect(request).not.toBeNull();
    expect(request?.status).toBe("PENDING");
    expect(request?.policyEvaluationId).toBe(result.evaluationId);
  });

  it("records an approval.requested audit event with a SYSTEM actor", async () => {
    const result = await requireApproval("audit-on-request");

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: orgA.id, entityId: result.approvalRequestId, eventType: "approval.requested" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorType).toBe("SYSTEM");
    expect(audit?.traceId).toBe(result.traceId);
  });

  it("shares one traceId across the evaluation and the approval request", async () => {
    const result = await requireApproval("trace-correlation");

    const request = await getApprovalRequest(orgA.id, result.approvalRequestId);
    const evaluation = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: result.evaluationId } });

    expect(request?.traceId).toBe(result.traceId);
    expect(evaluation.traceId).toBe(result.traceId);
  });
});

describe("idempotency", () => {
  it("does not create a duplicate approval request for the same evaluation", async () => {
    const result = await requireApproval("idempotency-test");

    const retry = await prisma.$transaction((tx) =>
      createApprovalRequestForEvaluation(tx, {
        organizationId: orgA.id,
        agentId: agentA.id,
        policyEvaluationId: result.evaluationId,
        action: "test.approve",
        reason: "simulated retry",
      })
    );

    expect(retry.id).toBe(result.approvalRequestId);

    const count = await prisma.approvalRequest.count({ where: { policyEvaluationId: result.evaluationId } });
    expect(count).toBe(1);
  });
});

describe("resolution", () => {
  it("approves a pending request and records a decision, audit event, and activity event", async () => {
    const result = await requireApproval("approve-test");

    const resolved = await resolveApproval(orgA.id, result.approvalRequestId, approver.id, "APPROVED", "Looks good.");
    expect(resolved.status).toBe("APPROVED");
    expect(resolved.decisions).toHaveLength(1);
    expect(resolved.decisions[0].decision).toBe("APPROVED");
    expect(resolved.decisions[0].comment).toBe("Looks good.");

    const activity = await prisma.activityEvent.findFirst({
      where: { organizationId: orgA.id, traceId: result.traceId, action: "approval.approve" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.status).toBe("ALLOWED");

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: orgA.id, entityId: result.approvalRequestId, eventType: "approval.approved" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorType).toBe("USER");
    expect(audit?.actorUserId).toBe(approver.id);
  });

  it("rejects a pending request and records a decision, audit event, and activity event", async () => {
    const result = await requireApproval("reject-test");

    const resolved = await resolveApproval(orgA.id, result.approvalRequestId, approver.id, "REJECTED", "Not this time.");
    expect(resolved.status).toBe("REJECTED");
    expect(resolved.decisions[0].decision).toBe("REJECTED");

    const activity = await prisma.activityEvent.findFirst({
      where: { organizationId: orgA.id, traceId: result.traceId, action: "approval.reject" },
    });
    expect(activity?.status).toBe("BLOCKED");

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: orgA.id, entityId: result.approvalRequestId, eventType: "approval.rejected" },
    });
    expect(audit).not.toBeNull();
  });

  it("prevents resolving an already-resolved request a second time", async () => {
    const result = await requireApproval("double-resolution-test");

    await resolveApproval(orgA.id, result.approvalRequestId, approver.id, "APPROVED");

    await expect(
      resolveApproval(orgA.id, result.approvalRequestId, approver.id, "REJECTED")
    ).rejects.toThrow(ApprovalAlreadyResolvedError);

    const decisionCount = await prisma.approvalDecision.count({
      where: { approvalRequestId: result.approvalRequestId },
    });
    expect(decisionCount).toBe(1);
  });
});

describe("expiration", () => {
  it("cannot be resolved once expired, and resolveApproval lazily flips it to EXPIRED", async () => {
    const result = await requireApproval("resolve-expiry-test");
    await prisma.approvalRequest.update({
      where: { id: result.approvalRequestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      resolveApproval(orgA.id, result.approvalRequestId, approver.id, "APPROVED")
    ).rejects.toThrow(ApprovalExpiredError);

    const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId } });
    expect(after.status).toBe("EXPIRED");
  });

  it("getApprovalRequest lazily flips a PENDING request past its expiresAt to EXPIRED on read", async () => {
    const result = await requireApproval("read-expiry-test");
    await prisma.approvalRequest.update({
      where: { id: result.approvalRequestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const fetched = await getApprovalRequest(orgA.id, result.approvalRequestId);
    expect(fetched?.status).toBe("EXPIRED");
  });
});

describe("organization isolation", () => {
  it("never lets another organization fetch an approval request", async () => {
    const result = await requireApproval("isolation-read-test");
    const fetchedFromB = await getApprovalRequest(orgB.id, result.approvalRequestId);
    expect(fetchedFromB).toBeNull();
  });

  it("never lets another organization resolve an approval request", async () => {
    const result = await requireApproval("isolation-resolve-test");

    await expect(
      resolveApproval(orgB.id, result.approvalRequestId, approver.id, "APPROVED")
    ).rejects.toThrow(ApprovalNotFoundError);

    const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalRequestId } });
    expect(request.status).toBe("PENDING");
  });
});
