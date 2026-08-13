import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ActivityFiltersInput } from "@/lib/validation/activity";

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
    ...(since ? { timestamp: { gte: since } } : {}),
    ...(filters.q
      ? {
          OR: [
            { action: { contains: filters.q, mode: "insensitive" } },
            { resource: { contains: filters.q, mode: "insensitive" } },
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

/** Feeds Agent Detail's risk overview — blocked/approval-required counts in a recent window. */
export async function getAgentActivityStatusCounts(organizationId: string, agentId: string, sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const [blocked, approvalRequired] = await Promise.all([
    prisma.activityEvent.count({ where: { organizationId, agentId, status: "BLOCKED", timestamp: { gte: since } } }),
    prisma.activityEvent.count({ where: { organizationId, agentId, status: "APPROVAL_REQUIRED", timestamp: { gte: since } } }),
  ]);
  return { blocked, approvalRequired };
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
