import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ActivityFiltersInput } from "@/lib/validation/activity";
import { normalizeKey } from "@/lib/telemetry/normalize";

const PAGE_SIZE = 25;

function rangeToDate(range: ActivityFiltersInput["range"]): Date | undefined {
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    default:
      return undefined;
  }
}

export async function listActivityEvents(
  organizationId: string,
  filters: ActivityFiltersInput
) {
  const since = rangeToDate(filters.range);

  const where: Prisma.ActivityEventWhereInput = {
    organizationId,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.toolName ? { toolKey: normalizeKey(filters.toolName) ?? filters.toolName } : {}),
    ...(since ? { timestamp: { gte: since } } : {}),
    ...(filters.q
      ? {
          OR: [
            { action: { contains: filters.q, mode: "insensitive" } },
            { resource: { contains: filters.q, mode: "insensitive" } },
            { description: { contains: filters.q, mode: "insensitive" } },
            { toolName: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    prisma.activityEvent.findMany({
      where,
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: { timestamp: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.activityEvent.count({ where }),
  ]);

  return {
    events,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
  };
}

/**
 * Distinct tools reported for this org — populates the Activity page's Tool
 * filter. One entry per normalized tool key (P1), so "CRM" and "crm" are one
 * tool, not two.
 */
export async function listDistinctToolNames(organizationId: string): Promise<string[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { organizationId, toolKey: { not: null } },
    distinct: ["toolKey"],
    select: { toolKey: true },
    orderBy: { toolKey: "asc" },
    take: 100,
  });
  return rows.map((r) => r.toolKey).filter((key): key is string => key !== null);
}

export async function getActivityEvent(organizationId: string, id: string) {
  return prisma.activityEvent.findFirst({
    where: { id, organizationId },
    include: { agent: { select: { id: true, name: true, slug: true } } },
  });
}

export async function getRecentActivity(organizationId: string, limit = 8) {
  return prisma.activityEvent.findMany({
    where: { organizationId },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
}

/** Every activity event sharing a trace ID — the "related activity" list on approval/evaluation detail views. */
export async function getActivityByTraceId(organizationId: string, traceId: string) {
  return prisma.activityEvent.findMany({
    where: { organizationId, traceId },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: { timestamp: "asc" },
  });
}

export async function getAgentActivity(organizationId: string, agentId: string, limit = 15) {
  return prisma.activityEvent.findMany({
    where: { organizationId, agentId },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
}

/** Feeds Agent Detail's Agent Health card — every count is a real, indexed query over a recent window, never a fabricated number. */
export async function getAgentActivityStatusCounts(organizationId: string, agentId: string, sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const [total, blocked, approvalRequired, warnings, highRisk] = await Promise.all([
    prisma.activityEvent.count({ where: { organizationId, agentId, timestamp: { gte: since } } }),
    prisma.activityEvent.count({ where: { organizationId, agentId, status: "BLOCKED", timestamp: { gte: since } } }),
    prisma.activityEvent.count({ where: { organizationId, agentId, status: "APPROVAL_REQUIRED", timestamp: { gte: since } } }),
    prisma.activityEvent.count({ where: { organizationId, agentId, status: "WARNING", timestamp: { gte: since } } }),
    prisma.activityEvent.count({
      where: { organizationId, agentId, riskLevel: { in: ["HIGH", "CRITICAL"] }, timestamp: { gte: since } },
    }),
  ]);
  return { total, blocked, approvalRequired, warnings, highRisk };
}

/** Actions in the last rolling hour — the "500 actions this hour" side of the volume-spike detector. */
export async function getActionsInLastHourForAgent(organizationId: string, agentId: string): Promise<number> {
  return prisma.activityEvent.count({
    where: { organizationId, agentId, timestamp: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}

/** Average actions/hour over the 7 days before the current hour — excludes the current hour so a spike can't dilute its own baseline. */
export async function getTrailingHourlyAverageForAgent(organizationId: string, agentId: string): Promise<number> {
  const currentHourStart = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(currentHourStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const count = await prisma.activityEvent.count({
    where: { organizationId, agentId, timestamp: { gte: sevenDaysAgo, lt: currentHourStart } },
  });

  return count / (7 * 24);
}

export async function getOrgEventCount(organizationId: string) {
  return prisma.activityEvent.count({ where: { organizationId } });
}

export async function getOrgSpendSummary(organizationId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await prisma.activityEvent.aggregate({
    where: { organizationId, timestamp: { gte: startOfMonth }, costCents: { not: null } },
    _sum: { costCents: true },
  });

  return result._sum.costCents ?? 0;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Today's count of events matching an extra filter, for one agent — the
 * "today" side of a baseline-relative spike detector (see
 * lib/security/detectors.ts's detectDataAccessSpike,
 * detectDeleteActivitySpike, detectExternalCommunicationSpike). Generic
 * over `extraWhere` so those three detectors share one query shape instead
 * of three near-duplicate functions.
 */
export async function getTodayEventCountForAgent(
  organizationId: string,
  agentId: string,
  extraWhere: Prisma.ActivityEventWhereInput = {}
): Promise<number> {
  const since = startOfUtcDay(new Date());
  return prisma.activityEvent.count({ where: { organizationId, agentId, timestamp: { gte: since }, ...extraWhere } });
}

/**
 * Trailing 7-day daily average count of events matching an extra filter,
 * excluding today — same "exclude today so a spike can't dilute its own
 * baseline" convention as getTrailingDailyAverageCentsForAgent
 * (lib/costs/queries.ts).
 */
export async function getTrailingDailyAverageEventCountForAgent(
  organizationId: string,
  agentId: string,
  extraWhere: Prisma.ActivityEventWhereInput = {}
): Promise<number> {
  const todayStart = startOfUtcDay(new Date());
  const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const count = await prisma.activityEvent.count({
    where: { organizationId, agentId, timestamp: { gte: sevenDaysAgo, lt: todayStart }, ...extraWhere },
  });
  return count / 7;
}

export async function getRiskEventCount(organizationId: string) {
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  return prisma.activityEvent.count({
    where: {
      organizationId,
      timestamp: { gte: startOfWeek },
      riskLevel: { in: ["HIGH", "CRITICAL"] },
    },
  });
}
