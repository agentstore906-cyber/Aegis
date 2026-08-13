import "server-only";

import type { AuditResult, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type AuditFilters = {
  eventType?: string;
  actorUserId?: string;
  agentId?: string;
  result?: AuditResult;
  range?: "24h" | "7d" | "30d" | "all";
  page: number;
};

const PAGE_SIZE = 25;

function rangeToDate(range: AuditFilters["range"]): Date | undefined {
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

export async function listAuditEvents(organizationId: string, filters: AuditFilters) {
  const since = rangeToDate(filters.range);

  const where: Prisma.AuditEventWhereInput = {
    organizationId,
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: {
        actorUser: { select: { id: true, name: true, email: true } },
        agent: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return {
    events,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
  };
}

export async function getAuditEvent(organizationId: string, id: string) {
  return prisma.auditEvent.findFirst({
    where: { id, organizationId },
    include: {
      actorUser: { select: { id: true, name: true, email: true } },
      agent: { select: { id: true, name: true, slug: true } },
    },
  });
}

/** Distinct event types actually present for an org, used to populate the audit filter dropdown. */
export async function listDistinctAuditEventTypes(organizationId: string) {
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId },
    distinct: ["eventType"],
    select: { eventType: true },
    orderBy: { eventType: "asc" },
  });
  return rows.map((r) => r.eventType);
}
