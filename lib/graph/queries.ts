import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { buildActionGraph, type MissingParentKind } from "@/lib/graph/build";
import type { ActionGraph, DecisionInfo, GraphEventRow } from "@/lib/graph/types";

/**
 * Read side of the Agent Action Graph. Every query filters on organizationId
 * AND agentId (callers resolve the agent inside the caller's organization
 * first), and every query is bounded:
 *
 *   runs   a window of days + a hard cap on rows scanned, keyset-paginated
 *   graph  one run's events, keyset-paginated by (timestamp, id), page size
 *          capped; never a recursive query — P1 guarantees a parent shares its
 *          child's trace, so "the run" is a single indexed lookup by traceId
 *
 * Nothing is stored for the graph: it is derived from ActivityEvent plus the
 * policy evaluation / approval / deviations already linked to each event.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const GRAPH_LIMITS = {
  runsDefault: 20,
  runsMax: 50,
  runWindowDaysDefault: 7,
  runWindowDaysMax: 30,
  /** Newest events scanned when listing runs; a run partly outside it is shown as partial. */
  runScanCap: 50_000,
  eventsDefault: 100,
  eventsMax: 500,
  /** Entity lists on the run summary. */
  entityLimit: 50,
} as const;

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value as number) : fallback, min), max);

// -- Cursors -----------------------------------------------------------------

export function encodeCursor(timestamp: Date, key: string): string {
  return Buffer.from(`${timestamp.toISOString()}|${key}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { timestamp: Date; key: string } | null {
  if (!cursor) return null;
  try {
    const [iso, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const timestamp = new Date(iso);
    const key = rest.join("|");
    return Number.isNaN(timestamp.getTime()) || !key ? null : { timestamp, key };
  } catch {
    return null;
  }
}

// -- Runs --------------------------------------------------------------------

export type RunSummary = {
  traceId: string;
  firstAction: string | null;
  taskId: string | null;
  events: number;
  firstAt: Date;
  lastAt: Date;
  blocked: number;
  approvalRequired: number;
  maxRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  tools: number;
  destinations: number;
};

export type RunList = {
  runs: RunSummary[];
  nextCursor: string | null;
  windowDays: number;
  since: Date;
  /** The scan cap was reached: older events in the window were not examined, so the oldest runs may be partial. */
  scanTruncated: boolean;
  /** Events in the window that carry no trace id and therefore belong to no run. */
  ungroupedEvents: number;
};

const RISK_NAMES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export async function listRuns(
  organizationId: string,
  agentId: string,
  options: { days?: number; limit?: number; cursor?: string | null; now?: Date } = {}
): Promise<RunList> {
  const windowDays = clamp(options.days, GRAPH_LIMITS.runWindowDaysDefault, 1, GRAPH_LIMITS.runWindowDaysMax);
  const limit = clamp(options.limit, GRAPH_LIMITS.runsDefault, 1, GRAPH_LIMITS.runsMax);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const cursor = decodeCursor(options.cursor);
  const having = cursor
    ? Prisma.sql`HAVING (MAX("timestamp"), "traceId") < (${cursor.timestamp.toISOString()}::timestamp, ${cursor.key})`
    : Prisma.empty;

  const [rows, scanned, ungrouped] = await Promise.all([
    prisma.$queryRaw<
      {
        trace_id: string;
        first_action: string | null;
        task_id: string | null;
        events: number;
        first_at: Date;
        last_at: Date;
        blocked: number;
        gated: number;
        max_risk: number;
        tools: number;
        destinations: number;
      }[]
    >`
      SELECT "traceId" AS trace_id,
             (ARRAY_AGG("action" ORDER BY "timestamp" ASC, "id" ASC))[1] AS first_action,
             MAX("taskId") AS task_id,
             COUNT(*)::int AS events,
             MIN("timestamp") AS first_at,
             MAX("timestamp") AS last_at,
             COUNT(*) FILTER (WHERE "status" = 'BLOCKED')::int AS blocked,
             COUNT(*) FILTER (WHERE "status" = 'APPROVAL_REQUIRED')::int AS gated,
             MAX(CASE "riskLevel" WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END)::int AS max_risk,
             COUNT(DISTINCT "toolKey")::int AS tools,
             COUNT(DISTINCT "destination")::int AS destinations
        FROM (
          SELECT "traceId", "action", "taskId", "timestamp", "id", "status", "riskLevel", "toolKey", "destination"
            FROM "activity_events"
           WHERE "organizationId" = ${organizationId}
             AND "agentId" = ${agentId}
             AND "traceId" IS NOT NULL
             AND "timestamp" >= ${since.toISOString()}::timestamp
           ORDER BY "timestamp" DESC
           LIMIT ${GRAPH_LIMITS.runScanCap}
        ) e
       GROUP BY "traceId"
       ${having}
       ORDER BY MAX("timestamp") DESC, "traceId" DESC
       LIMIT ${limit + 1}`,
    prisma.activityEvent.count({
      where: { organizationId, agentId, traceId: { not: null }, timestamp: { gte: since } },
      take: GRAPH_LIMITS.runScanCap + 1,
    }),
    prisma.activityEvent.count({ where: { organizationId, agentId, traceId: null, timestamp: { gte: since } } }),
  ]);

  const page = rows.slice(0, limit);
  const runs: RunSummary[] = page.map((r) => ({
    traceId: r.trace_id,
    firstAction: r.first_action,
    taskId: r.task_id,
    events: Number(r.events),
    firstAt: r.first_at,
    lastAt: r.last_at,
    blocked: Number(r.blocked),
    approvalRequired: Number(r.gated),
    maxRisk: RISK_NAMES[Math.min(Number(r.max_risk), 3)],
    tools: Number(r.tools),
    destinations: Number(r.destinations),
  }));
  const last = page[page.length - 1];
  return {
    runs,
    nextCursor: rows.length > limit && last ? encodeCursor(last.last_at, last.trace_id) : null,
    windowDays,
    since,
    scanTruncated: scanned > GRAPH_LIMITS.runScanCap,
    ungroupedEvents: ungrouped,
  };
}

// -- One run -----------------------------------------------------------------

export type RunSummaryStats = {
  /** Whole run, not just this page. */
  events: number;
  firstAt: Date;
  lastAt: Date;
  byStatus: Record<string, number>;
  decisions: Record<string, number>;
  maxRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  tools: { key: string; count: number }[];
  destinations: { key: string; count: number }[];
  dataClasses: { key: string; count: number }[];
  endUsers: number;
  taskIds: string[];
};

export type RunGraph = {
  traceId: string;
  agent: { id: string; name: string; slug: string };
  stats: RunSummaryStats;
  graph: ActionGraph;
  page: { size: number; returned: number; nextCursor: string | null; cursor: string | null };
};

const EVENT_SELECT = {
  id: true,
  timestamp: true,
  occurredAt: true,
  eventType: true,
  action: true,
  resource: true,
  description: true,
  toolName: true,
  toolKey: true,
  service: true,
  destination: true,
  destinationKind: true,
  endUserHash: true,
  dataClasses: true,
  dataSensitivity: true,
  recordCount: true,
  byteCount: true,
  status: true,
  riskLevel: true,
  outcome: true,
  source: true,
  durationMs: true,
  taskId: true,
  taskType: true,
  clientEventId: true,
  parentEventId: true,
  parentClientEventId: true,
  evaluationId: true,
  errorMessage: true,
  metadata: true,
  riskSignals: true,
  policyEvaluation: {
    select: {
      id: true,
      organizationId: true,
      decision: true,
      policyDecision: true,
      decisionSource: true,
      reason: true,
      matchedPolicySnapshots: true,
      permissionSnapshot: true,
      riskAssessedLevel: true,
      riskRecommendedDecision: true,
      riskControlOutcome: true,
      riskControlMode: true,
      riskControl: true,
      consumedApprovalRequestId: true,
      createdAt: true,
      approvalRequest: { select: { id: true, organizationId: true, status: true, expiresAt: true, resolvedAt: true } },
    },
  },
  executedUnderEvaluation: { select: { id: true, organizationId: true, decision: true, decisionSource: true } },
  deviations: { select: { kind: true, confidence: true, explanation: true }, take: 10 },
} satisfies Prisma.ActivityEventSelect;

type EventRecord = Prisma.ActivityEventGetPayload<{ select: typeof EVENT_SELECT }>;

/**
 * Defense in depth: foreign keys do not themselves enforce "same organization", so a joined
 * evaluation or approval from another tenant (a row that should be impossible) is ignored rather than shown.
 */
function toRow(e: EventRecord, organizationId: string): GraphEventRow {
  const ev = e.policyEvaluation && e.policyEvaluation.organizationId === organizationId ? e.policyEvaluation : null;
  const under = e.executedUnderEvaluation && e.executedUnderEvaluation.organizationId === organizationId ? e.executedUnderEvaluation : null;
  let decision: DecisionInfo | null = null;
  if (ev) {
    const control = (ev.riskControl ?? null) as { signals?: { code: string; family: string; severity: string }[]; trust?: { state: string; score: number } | null } | null;
    decision = {
      evaluationId: ev.id,
      decision: ev.decision,
      policyDecision: ev.policyDecision,
      decisionSource: ev.decisionSource,
      reason: ev.reason,
      matchedPolicies: ((ev.matchedPolicySnapshots as { id: string; name: string; decision: string }[] | null) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        decision: p.decision,
      })),
      permission: (ev.permissionSnapshot as { action: string; decision: string } | null)
        ? { action: (ev.permissionSnapshot as { action: string }).action, decision: (ev.permissionSnapshot as { decision: string }).decision }
        : null,
      riskLevel: ev.riskAssessedLevel,
      riskRecommended: ev.riskRecommendedDecision,
      riskControlOutcome: ev.riskControlOutcome,
      riskControlMode: ev.riskControlMode,
      riskSignals: control?.signals ?? [],
      trust: control?.trust ? { state: control.trust.state, score: control.trust.score } : null,
      approval: ev.approvalRequest && ev.approvalRequest.organizationId === organizationId ? { id: ev.approvalRequest.id, status: ev.approvalRequest.status, expiresAt: ev.approvalRequest.expiresAt, resolvedAt: ev.approvalRequest.resolvedAt } : null,
      consumedApprovalRequestId: ev.consumedApprovalRequestId,
      createdAt: ev.createdAt,
    };
  }
  return {
    id: e.id,
    timestamp: e.timestamp,
    occurredAt: e.occurredAt,
    eventType: e.eventType,
    action: e.action,
    resource: e.resource,
    description: e.description,
    toolName: e.toolName,
    toolKey: e.toolKey,
    service: e.service,
    destination: e.destination,
    destinationKind: e.destinationKind,
    endUserHash: e.endUserHash,
    dataClasses: e.dataClasses,
    dataSensitivity: e.dataSensitivity,
    recordCount: e.recordCount,
    byteCount: e.byteCount,
    status: e.status,
    riskLevel: e.riskLevel,
    outcome: e.outcome,
    source: e.source,
    durationMs: e.durationMs,
    taskId: e.taskId,
    taskType: e.taskType,
    clientEventId: e.clientEventId,
    parentEventId: e.parentEventId,
    parentClientEventId: e.parentClientEventId,
    // A reference to an evaluation outside this organization is dropped along with the evaluation itself.
    evaluationId: under ? e.evaluationId : null,
    errorMessage: e.errorMessage,
    metadata: e.metadata,
    riskSignals: e.riskSignals,
    decision,
    ranUnder: under ? { evaluationId: under.id, decision: under.decision, decisionSource: under.decisionSource } : null,
    deviations: e.deviations.map((d) => ({ kind: d.kind, confidence: d.confidence, explanation: d.explanation })),
  };
}

async function runStats(organizationId: string, agentId: string, traceId: string): Promise<RunSummaryStats | null> {
  const [scalar, tools, destinations, classes, decisions, tasks] = await Promise.all([
    prisma.$queryRaw<
      { events: number; first_at: Date | null; last_at: Date | null; max_risk: number | null; users: number; blocked: number; gated: number; allowed: number; failed: number; warning: number }[]
    >`
      SELECT COUNT(*)::int AS events, MIN("timestamp") AS first_at, MAX("timestamp") AS last_at,
             MAX(CASE "riskLevel" WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END)::int AS max_risk,
             COUNT(DISTINCT "endUserHash")::int AS users,
             COUNT(*) FILTER (WHERE "status" = 'BLOCKED')::int AS blocked,
             COUNT(*) FILTER (WHERE "status" = 'APPROVAL_REQUIRED')::int AS gated,
             COUNT(*) FILTER (WHERE "status" = 'ALLOWED')::int AS allowed,
             COUNT(*) FILTER (WHERE "status" = 'FAILED')::int AS failed,
             COUNT(*) FILTER (WHERE "status" = 'WARNING')::int AS warning
        FROM "activity_events"
       WHERE "organizationId" = ${organizationId} AND "agentId" = ${agentId} AND "traceId" = ${traceId}`,
    prisma.activityEvent.groupBy({
      by: ["toolKey"],
      where: { organizationId, agentId, traceId, toolKey: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { toolKey: "desc" } },
      take: GRAPH_LIMITS.entityLimit,
    }),
    prisma.activityEvent.groupBy({
      by: ["destination"],
      where: { organizationId, agentId, traceId, destination: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { destination: "desc" } },
      take: GRAPH_LIMITS.entityLimit,
    }),
    prisma.$queryRaw<{ data_class: string; count: number }[]>`
      SELECT dc::text AS data_class, COUNT(*)::int AS count
        FROM "activity_events", unnest("dataClasses") AS dc
       WHERE "organizationId" = ${organizationId} AND "agentId" = ${agentId} AND "traceId" = ${traceId}
       GROUP BY 1 ORDER BY count DESC LIMIT ${GRAPH_LIMITS.entityLimit}`,
    prisma.policyEvaluation.groupBy({ by: ["decision"], where: { organizationId, agentId, traceId }, _count: { _all: true } }),
    prisma.activityEvent.groupBy({ by: ["taskId"], where: { organizationId, agentId, traceId, taskId: { not: null } }, orderBy: { taskId: "asc" }, take: 10 }),
  ]);

  const s = scalar[0];
  if (!s || Number(s.events) === 0 || !s.first_at || !s.last_at) return null;
  return {
    events: Number(s.events),
    firstAt: s.first_at,
    lastAt: s.last_at,
    byStatus: { ALLOWED: Number(s.allowed), BLOCKED: Number(s.blocked), APPROVAL_REQUIRED: Number(s.gated), FAILED: Number(s.failed), WARNING: Number(s.warning) },
    decisions: Object.fromEntries(decisions.map((d) => [d.decision, d._count._all])),
    maxRisk: RISK_NAMES[Math.min(Number(s.max_risk ?? 0), 3)],
    tools: tools.flatMap((t) => (t.toolKey ? [{ key: t.toolKey, count: t._count._all }] : [])),
    destinations: destinations.flatMap((d) => (d.destination ? [{ key: d.destination, count: d._count._all }] : [])),
    dataClasses: classes.map((c) => ({ key: c.data_class, count: Number(c.count) })),
    endUsers: Number(s.users),
    taskIds: tasks.flatMap((t) => (t.taskId ? [t.taskId] : [])),
  };
}

/**
 * One page of one run's graph, or null when the run does not exist for this
 * organization's agent (including when the trace id belongs to someone else —
 * indistinguishable from not found, by design).
 */
export async function getRunGraph(
  organizationId: string,
  agent: { id: string; name: string; slug: string },
  traceId: string,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<RunGraph | null> {
  const size = clamp(options.limit, GRAPH_LIMITS.eventsDefault, 1, GRAPH_LIMITS.eventsMax);
  const cursor = decodeCursor(options.cursor);
  const base = { organizationId, agentId: agent.id, traceId };

  const [stats, records] = await Promise.all([
    runStats(organizationId, agent.id, traceId),
    prisma.activityEvent.findMany({
      where: cursor
        ? { ...base, OR: [{ timestamp: { gt: cursor.timestamp } }, { timestamp: cursor.timestamp, id: { gt: cursor.key } }] }
        : base,
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: size + 1,
      select: EVENT_SELECT,
    }),
  ]);
  if (!stats) return null;

  const pageRecords = records.slice(0, size);
  const last = pageRecords[pageRecords.length - 1];
  const rows = pageRecords.map((r) => toRow(r, organizationId));

  // Parents that are not on this page: do they exist in this run (another page)?
  const onPage = new Set(rows.map((r) => r.id));
  const missing = [...new Set(rows.flatMap((r) => (r.parentEventId && !onPage.has(r.parentEventId) ? [r.parentEventId] : [])))];
  const parentLookup = new Map<string, MissingParentKind>();
  if (missing.length > 0) {
    const found = await prisma.activityEvent.findMany({
      where: { organizationId, agentId: agent.id, traceId, id: { in: missing } },
      select: { id: true },
    });
    for (const f of found) parentLookup.set(f.id, "same_run");
  }

  return {
    traceId,
    agent,
    stats,
    graph: buildActionGraph({ agent, traceId, rows, parentLookup }),
    page: {
      size,
      returned: rows.length,
      cursor: options.cursor ?? null,
      nextCursor: records.length > size && last ? encodeCursor(last.timestamp, last.id) : null,
    },
  };
}
