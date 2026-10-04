import "server-only";

import type { ApprovalStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalNotFoundError,
} from "@/lib/approvals/types";
import { getApprovalRequest } from "@/lib/approvals/repository";
import { APPROVAL_EXECUTION_TTL_MS } from "@/lib/approvals/binding";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { trackEvent } from "@/lib/analytics/track";
import { scheduleTrustEvaluation } from "@/lib/trust/evaluate";

/**
 * Phase-4-ready service layer: these are the exact functions a future
 * SDK/Gateway ingestion endpoint would call to answer "what happened to my
 * approval request" or to resolve one on a human's behalf, per spec §21.
 * Server Actions (lib/approvals/actions.ts) are a thin auth-checking
 * wrapper around them — they hold no business logic of their own.
 */

export async function getApprovalStatus(organizationId: string, id: string) {
  return getApprovalRequest(organizationId, id);
}

type Decision = "APPROVED" | "REJECTED";

const DECISION_TO_STATUS = { APPROVED: "APPROVED", REJECTED: "REJECTED" } as const;
const DECISION_TO_AUDIT_EVENT = {
  APPROVED: AUDIT_EVENT_TYPES.APPROVAL_APPROVED,
  REJECTED: AUDIT_EVENT_TYPES.APPROVAL_REJECTED,
} as const;
const DECISION_TO_ACTION = {
  APPROVED: "approval.approve",
  REJECTED: "approval.reject",
} as const;
const DECISION_TO_WEBHOOK_EVENT = {
  APPROVED: "approval.approved",
  REJECTED: "approval.rejected",
} as const;

type ResolveOutcome =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_resolved"; status: ApprovalStatus }
  | { kind: "resolved"; request: ResolvedApprovalRequest };

type ResolvedApprovalRequest = Awaited<ReturnType<typeof loadResolvedRequest>>;

function loadResolvedRequest(tx: Prisma.TransactionClient, requestId: string) {
  return tx.approvalRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      agent: { select: { id: true, name: true, slug: true } },
      decisions: {
        include: { decidedBy: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

/**
 * Resolves a pending approval request. Race-safe against two people
 * resolving the same request at once: the conditional updateMany() only
 * flips rows that are still PENDING (and not expired), so under concurrent
 * calls exactly one transaction sees count === 1 and proceeds — the other
 * sees count === 0 and is told the request was already resolved, never a
 * silent second write.
 *
 * Every branch of the transaction *returns* a description of what
 * happened rather than throwing — Postgres aborts an entire interactive
 * transaction on the first error, so a thrown error would also roll back
 * the EXPIRED status write in the "already expired" branch. The
 * corresponding domain error is thrown once, after the transaction has
 * committed.
 */
export async function resolveApproval(
  organizationId: string,
  requestId: string,
  decidedByUserId: string,
  decision: Decision,
  comment?: string
) {
  const now = new Date();
  const targetStatus = DECISION_TO_STATUS[decision];

  const outcome = await prisma.$transaction(async (tx): Promise<ResolveOutcome> => {
    const updated = await tx.approvalRequest.updateMany({
      where: {
        id: requestId,
        organizationId,
        status: "PENDING",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      // APPROVED opens the single-use execution window (lib/approvals/binding.ts):
      // the agent must consume the approval via POST /api/v1/evaluate with
      // `approvalRequestId` before it closes.
      data: {
        status: targetStatus,
        resolvedAt: now,
        ...(decision === "APPROVED"
          ? { executionExpiresAt: new Date(now.getTime() + APPROVAL_EXECUTION_TTL_MS) }
          : {}),
      },
    });

    if (updated.count === 0) {
      const existing = await tx.approvalRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!existing) return { kind: "not_found" };

      if (existing.status === "PENDING" && existing.expiresAt && existing.expiresAt <= now) {
        await tx.approvalRequest.updateMany({
          where: { id: requestId, status: "PENDING" },
          data: { status: "EXPIRED", resolvedAt: now },
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorType: "SYSTEM",
          agentId: existing.agentId,
          eventType: AUDIT_EVENT_TYPES.APPROVAL_EXPIRED,
          entityType: "ApprovalRequest",
          entityId: existing.id,
          action: existing.action,
          traceId: existing.traceId,
        });
        return { kind: "expired" };
      }

      return { kind: "already_resolved", status: existing.status };
    }

    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });

    await tx.approvalDecision.create({
      data: {
        organizationId,
        approvalRequestId: requestId,
        decidedByUserId,
        decision,
        comment: comment && comment.length > 0 ? comment : undefined,
      },
    });

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: decidedByUserId,
      agentId: request.agentId,
      eventType: DECISION_TO_AUDIT_EVENT[decision],
      entityType: "ApprovalRequest",
      entityId: request.id,
      action: request.action,
      metadata: comment ? { comment } : undefined,
      traceId: request.traceId,
    });

    await tx.activityEvent.create({
      data: {
        organizationId,
        agentId: request.agentId,
        eventType: "SYSTEM",
        // Provenance (P1): a human's decision recorded by Aegis — not an
        // agent-reported event, which is what the "api" default means.
        source: "approval_resolution",
        action: DECISION_TO_ACTION[decision],
        resource: request.resource,
        status: decision === "APPROVED" ? "ALLOWED" : "BLOCKED",
        riskLevel: request.riskLevel ?? "LOW",
        traceId: request.traceId,
        metadata: comment ? { comment, approvalRequestId: request.id } : { approvalRequestId: request.id },
      },
    });

    return { kind: "resolved", request: await loadResolvedRequest(tx, requestId) };
  });

  switch (outcome.kind) {
    case "not_found":
      throw new ApprovalNotFoundError();
    case "expired":
      throw new ApprovalExpiredError();
    case "already_resolved":
      throw new ApprovalAlreadyResolvedError(outcome.status);
    case "resolved":
      trackEvent("approval_resolved", { organizationId, decision });
      if (decision === "REJECTED") {
        scheduleTrustEvaluation("approval", organizationId, outcome.request.agentId, {
          trigger: "APPROVAL_DECISION",
          triggerRef: outcome.request.id,
        });
      }
      await dispatchWebhookEvent(organizationId, DECISION_TO_WEBHOOK_EVENT[decision], {
        approvalRequestId: outcome.request.id,
        agentId: outcome.request.agentId,
        action: outcome.request.action,
        decidedByUserId,
        traceId: outcome.request.traceId,
      });
      return outcome.request;
  }
}

type CancelOutcome =
  | { kind: "not_found" }
  | { kind: "already_resolved"; status: ApprovalStatus }
  | { kind: "cancelled"; request: ResolvedApprovalRequest };

/**
 * Withdraws a still-PENDING request — e.g. the underlying condition no
 * longer applies. Not a decision (see the note above ApprovalDecisionType
 * in schema.prisma: CANCELLED is a status transition, never an
 * ApprovalDecision row), so this only ever writes the status + an audit
 * event, mirroring the EXPIRED branch in resolveApproval rather than the
 * APPROVED/REJECTED one. Same race-safe conditional updateMany pattern.
 */
export async function cancelApproval(organizationId: string, requestId: string, cancelledByUserId: string) {
  const outcome = await prisma.$transaction(async (tx): Promise<CancelOutcome> => {
    const updated = await tx.approvalRequest.updateMany({
      where: { id: requestId, organizationId, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });

    if (updated.count === 0) {
      const existing = await tx.approvalRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!existing) return { kind: "not_found" };
      return { kind: "already_resolved", status: existing.status };
    }

    const request = await loadResolvedRequest(tx, requestId);

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: cancelledByUserId,
      agentId: request.agentId,
      eventType: AUDIT_EVENT_TYPES.APPROVAL_CANCELLED,
      entityType: "ApprovalRequest",
      entityId: request.id,
      action: request.action,
      traceId: request.traceId,
    });

    return { kind: "cancelled", request };
  });

  switch (outcome.kind) {
    case "not_found":
      throw new ApprovalNotFoundError();
    case "already_resolved":
      throw new ApprovalAlreadyResolvedError(outcome.status);
    case "cancelled":
      return outcome.request;
  }
}
