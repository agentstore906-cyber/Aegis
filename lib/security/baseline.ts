import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DELETE_KEYWORDS, SENSITIVE_RESOURCE_KEYWORDS } from "@/lib/security/risk-scoring";

/**
 * Per-agent behavioral baseline (Phase 2 spec §1) — "what does normal
 * look like for this specific agent," computed from its own trailing
 * history. Deliberately per-agent, not a fleet-wide average: a finance
 * agent and a docs-QA agent have no reason to share a definition of
 * normal. This is the reference point lib/security/risk-score.ts and the
 * Agent Health card compare today's behavior against.
 *
 * Every metric here is a real, indexed-window count or sum over
 * ActivityEvent — never invented, never extrapolated from another
 * agent's history. When there isn't enough of an agent's own history to
 * make a baseline meaningful, getAgentBehavioralBaseline returns
 * `available: false` rather than a number computed from too little data
 * (spec: "Do not claim a baseline when insufficient data exists").
 */

const BASELINE_WINDOW_DAYS = 7;
// Below either floor, a "baseline" would just be noise — one event isn't
// a pattern, and a brand-new agent hasn't been running long enough for a
// daily rate to mean anything yet.
const MIN_BASELINE_EVENTS = 10;
const MIN_BASELINE_DAYS_OBSERVED = 3;

export type BehavioralBaselineMetrics = {
  /** Total ActivityEvent rows per day — the headline volume metric. */
  eventsPerDay: number;
  toolCallsPerDay: number;
  modelCallsPerDay: number;
  /** eventType DATA_ACCESS — reads and writes together; ActivityEvent doesn't structurally separate them (see docs/behavioral-intelligence.md). */
  dataAccessPerDay: number;
  /** Actions whose action/resource text matches a delete-shaped keyword (delete, remove, purge, erase, destroy). */
  destructiveActionsPerDay: number;
  /** eventType COMMUNICATION — covers email/message-send style actions. */
  communicationsPerDay: number;
  failedPerDay: number;
  blockedPerDay: number;
  /** null when this agent has never reported cost on any event — distinct from a real $0/day baseline. */
  costCentsPerDay: number | null;
};

export type BehavioralBaseline =
  | { available: false; eventsObserved: number; daysObserved: number; windowDays: number }
  | (BehavioralBaselineMetrics & { available: true; eventsObserved: number; daysObserved: number; windowDays: number });

function keywordFilter(keywords: readonly string[]): Prisma.ActivityEventWhereInput {
  return {
    OR: keywords.flatMap((keyword) => [
      { action: { contains: keyword, mode: "insensitive" as const } },
      { resource: { contains: keyword, mode: "insensitive" as const } },
    ]),
  };
}

export async function getAgentBehavioralBaseline(
  organizationId: string,
  agentId: string
): Promise<BehavioralBaseline> {
  const windowStart = new Date(Date.now() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const base: Prisma.ActivityEventWhereInput = { organizationId, agentId, timestamp: { gte: windowStart } };

  const [
    total,
    toolCalls,
    modelCalls,
    dataAccess,
    destructive,
    communications,
    failed,
    blocked,
    costAgg,
    firstEvent,
  ] = await Promise.all([
    prisma.activityEvent.count({ where: base }),
    prisma.activityEvent.count({ where: { ...base, eventType: "TOOL_CALL" } }),
    prisma.activityEvent.count({ where: { ...base, eventType: "MODEL_CALL" } }),
    prisma.activityEvent.count({ where: { ...base, eventType: "DATA_ACCESS" } }),
    prisma.activityEvent.count({ where: { ...base, ...keywordFilter(DELETE_KEYWORDS) } }),
    prisma.activityEvent.count({ where: { ...base, eventType: "COMMUNICATION" } }),
    prisma.activityEvent.count({ where: { ...base, status: "FAILED" } }),
    prisma.activityEvent.count({ where: { ...base, status: "BLOCKED" } }),
    prisma.activityEvent.aggregate({ where: { ...base, costCents: { not: null } }, _sum: { costCents: true } }),
    prisma.activityEvent.findFirst({
      where: { organizationId, agentId },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true },
    }),
  ]);

  // Cost was reported somewhere in the window -> we already know this agent
  // reports cost. Otherwise, check without the window (an unbounded
  // existence check, not a scan — findFirst short-circuits on the first
  // match) so "hasn't spent this week" isn't confused with "never reports
  // cost at all."
  const hasEverReportedCost = costAgg._sum.costCents !== null || (await hasAnyCostEver(organizationId, agentId));

  const daysObserved = firstEvent
    ? Math.min(BASELINE_WINDOW_DAYS, Math.max(1, Math.ceil((Date.now() - firstEvent.timestamp.getTime()) / (24 * 60 * 60 * 1000))))
    : 0;

  if (total < MIN_BASELINE_EVENTS || daysObserved < MIN_BASELINE_DAYS_OBSERVED) {
    return { available: false, eventsObserved: total, daysObserved, windowDays: BASELINE_WINDOW_DAYS };
  }

  const perDay = (count: number) => Math.round((count / daysObserved) * 100) / 100;

  return {
    available: true,
    eventsObserved: total,
    daysObserved,
    windowDays: BASELINE_WINDOW_DAYS,
    eventsPerDay: perDay(total),
    toolCallsPerDay: perDay(toolCalls),
    modelCallsPerDay: perDay(modelCalls),
    dataAccessPerDay: perDay(dataAccess),
    destructiveActionsPerDay: perDay(destructive),
    communicationsPerDay: perDay(communications),
    failedPerDay: perDay(failed),
    blockedPerDay: perDay(blocked),
    costCentsPerDay: hasEverReportedCost ? Math.round((costAgg._sum.costCents ?? 0) / daysObserved) : null,
  };
}

async function hasAnyCostEver(organizationId: string, agentId: string): Promise<boolean> {
  const row = await prisma.activityEvent.findFirst({
    where: { organizationId, agentId, costCents: { not: null } },
    select: { id: true },
  });
  return row !== null;
}
