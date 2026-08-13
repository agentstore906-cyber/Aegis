import "server-only";

import { Prisma } from "@prisma/client";
import type { ApprovalStatus, Environment, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

const APPROVAL_INCLUDE = {
  agent: { select: { id: true, name: true, slug: true, riskLevel: true } },
  decisions: {
    include: { decidedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  policyEvaluation: { select: { id: true, matchedPolicySnapshots: true, permissionSnapshot: true } },
} satisfies Prisma.ApprovalRequestInclude;

export type ApprovalRequestWithRelations = Prisma.ApprovalRequestGetPayload<{
  include: typeof APPROVAL_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// Creation — called from inside evaluate.ts's transaction when a policy
// evaluation resolves to REQUIRE_APPROVAL.
// ---------------------------------------------------------------------------

export type CreateApprovalRequestParams = {
  organizationId: string;
  agentId: string;
  policyEvaluationId: string;
  action: string;
  resource?: string | null;
  environment?: Environment | null;
  tool?: string | null;
  riskLevel?: RiskLevel | null;
  context?: Prisma.InputJsonValue;
  reason: string;
  traceId?: string | null;
  expiresAt?: Date | null;
};

/**
 * Idempotent under the unique constraint on policyEvaluationId: since every
 * evaluateAgentAction() call creates a brand-new PolicyEvaluation row, "one
 * evaluation -> at most one approval request" is guaranteed here even if
 * this function is ever called twice for the same evaluation (e.g. a
 * caller retrying). Checks first rather than optimistically creating and
 * catching P2002 — Postgres aborts the rest of an interactive transaction
 * after any failed statement, so recovering from a unique-constraint error
 * *within the same transaction* isn't possible; a plain SELECT-then-INSERT
 * is what actually works here. This isn't perfectly race-safe against two
 * fully concurrent transactions racing on the exact same evaluation id —
 * but the database's unique constraint still guarantees only one row can
 * ever exist, and the loser fails its whole transaction loudly (consistent
 * with "fail safely, never silently duplicate") rather than corrupting
 * data. See docs/approvals-and-audit.md for the full idempotency strategy
 * and its known limitation (dedup across distinct evaluations of the same
 * logical action is a Phase 4 concern).
 */
export async function createApprovalRequestForEvaluation(
  tx: Prisma.TransactionClient,
  params: CreateApprovalRequestParams
) {
  const existing = await tx.approvalRequest.findUnique({
    where: { policyEvaluationId: params.policyEvaluationId },
  });
  if (existing) return existing;

  return tx.approvalRequest.create({
    data: {
      organizationId: params.organizationId,
      agentId: params.agentId,
      policyEvaluationId: params.policyEvaluationId,
      action: params.action,
      resource: params.resource ?? undefined,
      environment: params.environment ?? undefined,
      tool: params.tool ?? undefined,
      riskLevel: params.riskLevel ?? undefined,
      context: params.context,
      reason: params.reason,
      traceId: params.traceId ?? undefined,
      expiresAt: params.expiresAt ?? undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ApprovalFilters = {
  status?: ApprovalStatus;
  agentId?: string;
  riskLevel?: RiskLevel;
  q?: string;
  page: number;
};

const APPROVAL_PAGE_SIZE = 20;

/**
 * Lists approval requests. When no status filter is given, defaults to
 * PENDING so the primary view surfaces what needs attention first — the
 * same "default to the actionable subset" pattern /agents uses for
 * status=NEEDS_ATTENTION, rather than fighting Prisma's lack of custom
 * enum ordering to interleave statuses within one query.
 */
export async function listApprovalRequests(organizationId: string, filters: ApprovalFilters) {
  const where: Prisma.ApprovalRequestWhereInput = {
    organizationId,
    status: filters.status ?? "PENDING",
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}),
    ...(filters.q
      ? {
          OR: [
            { action: { contains: filters.q, mode: "insensitive" } },
            { resource: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: { requestedAt: "desc" },
      skip: (filters.page - 1) * APPROVAL_PAGE_SIZE,
      take: APPROVAL_PAGE_SIZE,
    }),
    prisma.approvalRequest.count({ where }),
  ]);

  return {
    requests,
    total,
    pageCount: Math.max(1, Math.ceil(total / APPROVAL_PAGE_SIZE)),
    pageSize: APPROVAL_PAGE_SIZE,
  };
}

/**
 * Fetches one approval request, lazily flipping it to EXPIRED first if it's
 * still PENDING but past expiresAt — see docs/approvals-and-audit.md's
 * "Expiration" section for why this is lazy rather than a scheduled job.
 */
export async function getApprovalRequest(organizationId: string, id: string) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id, organizationId },
    include: APPROVAL_INCLUDE,
  });
  if (!request) return null;
  return expireIfNeeded(request);
}

export async function expireIfNeeded(
  request: ApprovalRequestWithRelations
): Promise<ApprovalRequestWithRelations> {
  if (request.status !== "PENDING" || !request.expiresAt || request.expiresAt > new Date()) {
    return request;
  }

  const resolvedAt = new Date();
  const result = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "EXPIRED", resolvedAt },
  });

  if (result.count === 0) {
    // Someone else resolved it between the read and this write — re-fetch to reflect reality.
    return prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include: APPROVAL_INCLUDE });
  }

  await recordAuditEvent(prisma, {
    organizationId: request.organizationId,
    actorType: "SYSTEM",
    agentId: request.agentId,
    eventType: AUDIT_EVENT_TYPES.APPROVAL_EXPIRED,
    entityType: "ApprovalRequest",
    entityId: request.id,
    action: request.action,
    traceId: request.traceId,
  });

  return { ...request, status: "EXPIRED", resolvedAt };
}

export async function listApprovalsForAgent(organizationId: string, agentId: string, limit = 10) {
  return prisma.approvalRequest.findMany({
    where: { organizationId, agentId },
    include: {
      decisions: {
        include: { decidedBy: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { requestedAt: "desc" },
    take: limit,
  });
}

export async function getApprovalStats(organizationId: string) {
  const [pending, highRiskPending, recentRejected] = await Promise.all([
    prisma.approvalRequest.count({ where: { organizationId, status: "PENDING" } }),
    prisma.approvalRequest.count({
      where: { organizationId, status: "PENDING", riskLevel: { in: ["HIGH", "CRITICAL"] } },
    }),
    prisma.approvalRequest.findMany({
      where: { organizationId, status: "REJECTED" },
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: { resolvedAt: "desc" },
      take: 5,
    }),
  ]);

  return { pending, highRiskPending, recentRejected };
}

export async function listTopPendingApprovals(organizationId: string, limit = 5) {
  return prisma.approvalRequest.findMany({
    where: { organizationId, status: "PENDING" },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: [{ riskLevel: { sort: "desc", nulls: "last" } }, { requestedAt: "asc" }],
    take: limit,
  });
}
