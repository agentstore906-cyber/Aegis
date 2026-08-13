import "server-only";

import { randomUUID } from "node:crypto";
import type { ActivityStatus, PolicyDecision } from "@prisma/client";

import { prisma } from "@/lib/db";
import { filterApplicablePolicies, resolveBestPermission } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { listActivePoliciesForEvaluation } from "@/lib/policies/repository";
import type { PolicyEvaluationInput, PolicyEvaluationResult } from "@/lib/policies/types";
import { createApprovalRequestForEvaluation } from "@/lib/approvals/repository";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { runSecurityDetectors } from "@/lib/security/evaluate";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { redactSecrets } from "@/lib/security/redact";
import { trackEvent } from "@/lib/analytics/track";

const DECISION_TO_ACTIVITY_STATUS: Record<PolicyDecision, ActivityStatus> = {
  ALLOW: "ALLOWED",
  REQUIRE_APPROVAL: "APPROVAL_REQUIRED",
  BLOCK: "BLOCKED",
};

/**
 * The single entry point for policy decisions. Framework-independent by
 * design (no Next.js request/response types) so it can be called from
 * Server Actions, an internal API route, or — once Phase 4 ships API
 * keys — an authenticated SDK ingestion endpoint, without change.
 *
 * Sequence: load baseline permission + candidate policies -> resolve the
 * strictest applicable decision -> persist the evaluation (and a linked
 * ActivityEvent) -> return a fully explainable result. Never swallows
 * errors into a silent ALLOW — if evaluation cannot complete, it throws.
 */
export async function evaluateAgentAction(
  input: PolicyEvaluationInput
): Promise<PolicyEvaluationResult> {
  const startedAt = Date.now();

  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
  });
  if (!agent) {
    throw new Error("Agent not found in this organization — refusing to evaluate.");
  }

  const traceId = input.traceId ?? randomUUID();

  const [permissions, candidatePolicies] = await Promise.all([
    prisma.agentPermission.findMany({ where: { organizationId: input.organizationId, agentId: input.agentId } }),
    listActivePoliciesForEvaluation(input.organizationId, input.agentId),
  ]);

  const permission = resolveBestPermission(permissions, input);
  const matchedPolicies = filterApplicablePolicies(candidatePolicies, input);

  const resolved = resolveDecision(permission, matchedPolicies, input);
  const durationMs = Date.now() - startedAt;

  // Caller-supplied context may carry secret-shaped keys (external API
  // callers, the policy tester) — redact once here so every downstream
  // write (ActivityEvent, PolicyEvaluation, and — if REQUIRE_APPROVAL —
  // ApprovalRequest) persists the same safe copy, never the raw value.
  const safeContext =
    input.context && Object.keys(input.context).length > 0 ? redactSecrets(input.context) : undefined;

  const { evaluation, approvalRequestId } = await prisma.$transaction(async (tx) => {
    const activityEvent = await tx.activityEvent.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        eventType: input.eventType ?? "ACTION",
        action: input.action,
        resource: input.resource,
        status: DECISION_TO_ACTIVITY_STATUS[resolved.decision],
        riskLevel: input.riskLevel ?? agent.riskLevel,
        durationMs,
        traceId,
        metadata: safeContext,
      },
    });

    const evaluation = await tx.policyEvaluation.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        action: input.action,
        resource: input.resource,
        environment: input.environment,
        tool: input.tool,
        riskLevel: input.riskLevel,
        context: safeContext,
        decision: resolved.decision,
        reason: resolved.reason,
        permissionId: resolved.matchedPermissionSnapshot?.id,
        permissionSnapshot: resolved.matchedPermissionSnapshot,
        matchedPolicyIds: resolved.matchedPolicySnapshots.map((p) => p.id),
        matchedPolicySnapshots: resolved.matchedPolicySnapshots,
        traceId,
        activityEventId: activityEvent.id,
      },
    });

    let approvalRequestId: string | undefined;

    if (resolved.decision === "REQUIRE_APPROVAL") {
      const approval = await createApprovalRequestForEvaluation(tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        policyEvaluationId: evaluation.id,
        action: input.action,
        resource: input.resource,
        environment: input.environment,
        tool: input.tool,
        riskLevel: input.riskLevel ?? agent.riskLevel,
        context: safeContext,
        reason: resolved.reason,
        traceId,
      });
      approvalRequestId = approval.id;

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "SYSTEM",
        agentId: input.agentId,
        eventType: AUDIT_EVENT_TYPES.APPROVAL_REQUESTED,
        entityType: "ApprovalRequest",
        entityId: approval.id,
        action: input.action,
        metadata: { reason: resolved.reason },
        traceId,
      });
    }

    return { evaluation, approvalRequestId };
  });

  if (approvalRequestId) {
    trackEvent("approval_created", { organizationId: input.organizationId, agentId: input.agentId });
    await dispatchWebhookEvent(input.organizationId, "approval.requested", {
      approvalRequestId,
      agentId: input.agentId,
      action: input.action,
      evaluationId: evaluation.id,
      traceId,
    });
  }

  await runSecurityDetectors({
    organizationId: input.organizationId,
    agent: { id: agent.id, name: agent.name },
    action: input.action,
    riskLevel: input.riskLevel ?? agent.riskLevel,
    status: DECISION_TO_ACTIVITY_STATUS[resolved.decision],
    traceId,
  });

  return {
    decision: resolved.decision,
    reason: resolved.reason,
    matchedPolicyIds: resolved.matchedPolicySnapshots.map((p) => p.id),
    matchedPolicySnapshots: resolved.matchedPolicySnapshots,
    matchedPermissionId: resolved.matchedPermissionSnapshot?.id,
    matchedPermissionSnapshot: resolved.matchedPermissionSnapshot,
    evaluationId: evaluation.id,
    approvalRequestId,
    traceId,
  };
}
