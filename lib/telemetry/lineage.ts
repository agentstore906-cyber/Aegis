import "server-only";

import type { PolicyDecision, Prisma } from "@prisma/client";

import { prisma, type PrismaOrTx } from "@/lib/db";

/**
 * Parent/child event lineage (P1 — docs/AEGIS_P1_DATA_FOUNDATION.md
 * "Parent / child model").
 *
 * A reported event can name its parent two ways:
 *   parentEventId        Aegis's own id (returned by a previous /events or
 *                        /evaluate call). Must already exist — otherwise 400.
 *                        Same organization always; for an agent-bound API key
 *                        also the same agent.
 *   parentClientEventId  The caller's own id for the parent (its
 *                        `clientEventId`), scoped to the same agent. Linked
 *                        immediately if that event exists; otherwise stored
 *                        as reported and linked the moment the parent arrives
 *                        (telemetry is often delivered out of order).
 *
 * An execution reported with `evaluationId` (the /evaluate decision it ran
 * under) defaults its parent to that decision's event, so
 * decision -> execution is always connected.
 *
 * Invariants:
 *   - parent and child are in the same organization (enforced on every path);
 *   - traces never conflict: a child inherits its parent's traceId, and a
 *     child whose explicit traceId differs from its parent's is rejected
 *     (direct link) or left unlinked (late link) — never silently re-traced;
 *   - no cycles: a late link never makes an event its own ancestor;
 *   - links are written once (NULL -> value); the DB append-only trigger
 *     forbids any other change.
 */

export const MAX_LINEAGE_DEPTH = 64;

export type LineageErrorCode = "INVALID_PARENT_EVENT" | "PARENT_TRACE_MISMATCH" | "INVALID_EVALUATION_REFERENCE";

export class LineageReferenceError extends Error {
  constructor(
    public readonly code: LineageErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LineageReferenceError";
  }
}

export type ResolvedLineage = {
  parentEventId: string | null;
  parentClientEventId: string | null;
  traceId: string | null;
  evaluationId: string | null;
  evaluationDecision: PolicyDecision | null;
};

export async function resolveLineage(params: {
  organizationId: string;
  agentId: string;
  /** Set when the API key is bound to one agent — parents must then be that agent's own events. */
  apiKeyAgentId: string | null;
  parentEventId?: string;
  parentClientEventId?: string;
  evaluationId?: string;
  traceId?: string | null;
}): Promise<ResolvedLineage> {
  const { organizationId, agentId } = params;
  let traceId = params.traceId ?? null;
  let parentEventId: string | null = null;
  let evaluationDecision: PolicyDecision | null = null;
  let evaluationId: string | null = null;

  const adoptTrace = (candidate: string | null, what: string) => {
    if (!candidate) return;
    if (traceId && traceId !== candidate) {
      throw new LineageReferenceError("PARENT_TRACE_MISMATCH", `\`traceId\` does not match the ${what}'s trace.`);
    }
    traceId = candidate;
  };

  if (params.evaluationId) {
    const evaluation = await prisma.policyEvaluation.findFirst({
      where: { id: params.evaluationId, organizationId, agentId },
      select: { id: true, decision: true, traceId: true, activityEventId: true },
    });
    if (!evaluation) {
      throw new LineageReferenceError(
        "INVALID_EVALUATION_REFERENCE",
        "`evaluationId` does not reference an evaluation of this agent in this organization."
      );
    }
    evaluationId = evaluation.id;
    evaluationDecision = evaluation.decision;
    adoptTrace(evaluation.traceId, "evaluation");
    if (!params.parentEventId && !params.parentClientEventId) parentEventId = evaluation.activityEventId;
  }

  if (params.parentEventId) {
    const parent = await prisma.activityEvent.findFirst({
      where: {
        id: params.parentEventId,
        organizationId,
        ...(params.apiKeyAgentId ? { agentId: params.apiKeyAgentId } : {}),
      },
      select: { id: true, traceId: true },
    });
    if (!parent) {
      throw new LineageReferenceError("INVALID_PARENT_EVENT", "`parentEventId` does not reference an event this API key can access.");
    }
    adoptTrace(parent.traceId, "parent event");
    parentEventId = parent.id;
  }

  if (params.parentClientEventId) {
    const parent = await prisma.activityEvent.findUnique({
      where: { organizationId_agentId_clientEventId: { organizationId, agentId, clientEventId: params.parentClientEventId } },
      select: { id: true, traceId: true },
    });
    if (parent) {
      adoptTrace(parent.traceId, "parent event");
      parentEventId = parent.id;
    }
  }

  return {
    parentEventId,
    parentClientEventId: params.parentClientEventId ?? null,
    traceId,
    evaluationId,
    evaluationDecision,
  };
}

/** Ids of an event and its ancestors (bounded), via one recursive query. Organization-scoped. */
export async function getAncestorIds(client: PrismaOrTx, organizationId: string, eventId: string): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain ("id", "parentEventId", depth) AS (
      SELECT "id", "parentEventId", 0 FROM "activity_events"
       WHERE "id" = ${eventId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT e."id", e."parentEventId", c.depth + 1
        FROM "activity_events" e JOIN chain c ON e."id" = c."parentEventId"
       WHERE c.depth < ${MAX_LINEAGE_DEPTH} AND e."organizationId" = ${organizationId}
    )
    SELECT "id" FROM chain`;
  return rows.map((r) => r.id);
}

/**
 * Called right after an event with a clientEventId is created: links any of
 * the same agent's earlier events that named it as parentClientEventId but
 * arrived first. Skips children that are this event's own ancestors (would
 * create a cycle) and children whose trace conflicts.
 */
export async function linkWaitingChildren(
  tx: Prisma.TransactionClient,
  event: { id: string; organizationId: string; agentId: string; clientEventId: string; traceId: string | null }
): Promise<number> {
  const ancestors = await getAncestorIds(tx, event.organizationId, event.id);
  const result = await tx.activityEvent.updateMany({
    where: {
      organizationId: event.organizationId,
      agentId: event.agentId,
      parentClientEventId: event.clientEventId,
      parentEventId: null,
      id: { notIn: ancestors },
      ...(event.traceId ? { OR: [{ traceId: null }, { traceId: event.traceId }] } : {}),
    },
    data: { parentEventId: event.id },
  });
  return result.count;
}

const LINEAGE_SELECT = {
  id: true,
  action: true,
  eventType: true,
  status: true,
  outcome: true,
  timestamp: true,
  source: true,
  agent: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ActivityEventSelect;

/**
 * Ancestors (root first) and direct children of one event — organization-
 * scoped at every step, so an event can never surface another tenant's
 * events even if a link were somehow wrong.
 */
export async function getEventLineage(organizationId: string, eventId: string, childLimit = 50) {
  const ancestorIds = (await getAncestorIds(prisma, organizationId, eventId)).filter((id) => id !== eventId);
  const [ancestors, children, childCount] = await Promise.all([
    ancestorIds.length
      ? prisma.activityEvent.findMany({ where: { organizationId, id: { in: ancestorIds } }, select: LINEAGE_SELECT })
      : Promise.resolve([]),
    prisma.activityEvent.findMany({
      where: { organizationId, parentEventId: eventId },
      select: LINEAGE_SELECT,
      orderBy: { timestamp: "asc" },
      take: childLimit,
    }),
    prisma.activityEvent.count({ where: { organizationId, parentEventId: eventId } }),
  ]);
  const order = new Map(ancestorIds.map((id, index) => [id, index]));
  ancestors.sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));
  return { ancestors, children, childCount };
}
