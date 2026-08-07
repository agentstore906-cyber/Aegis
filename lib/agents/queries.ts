import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AgentFiltersInput } from "@/lib/validation/agent";

const PAGE_SIZE = 20;

export async function listAgents(organizationId: string, filters: AgentFiltersInput) {
  const where: Prisma.AgentWhereInput = {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { owner: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [agents, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      include: { tools: true },
      orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.agent.count({ where }),
  ]);

  const spendByAgent = await getMonthlySpendByAgent(organizationId);

  return {
    agents: agents.map((agent) => ({
      ...agent,
      monthlySpendCents: spendByAgent.get(agent.id) ?? 0,
    })),
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pageSize: PAGE_SIZE,
  };
}

async function getMonthlySpendByAgent(organizationId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const grouped = await prisma.activityEvent.groupBy({
    by: ["agentId"],
    where: { organizationId, timestamp: { gte: startOfMonth }, costCents: { not: null } },
    _sum: { costCents: true },
  });

  return new Map(grouped.map((g) => [g.agentId, g._sum.costCents ?? 0]));
}

export async function getAgentStats(organizationId: string) {
  const grouped = await prisma.agent.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: true,
  });

  const stats = { total: 0, active: 0, paused: 0, needsAttention: 0, archived: 0 };
  for (const row of grouped) {
    stats.total += row._count;
    if (row.status === "ACTIVE") stats.active = row._count;
    if (row.status === "PAUSED") stats.paused = row._count;
    if (row.status === "NEEDS_ATTENTION") stats.needsAttention = row._count;
    if (row.status === "ARCHIVED") stats.archived = row._count;
  }
  return stats;
}

export async function getAgentBySlug(organizationId: string, slug: string) {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug } },
    include: { tools: true },
  });
  if (!agent) return null;

  const spendByAgent = await getMonthlySpendByAgent(organizationId);
  return { ...agent, monthlySpendCents: spendByAgent.get(agent.id) ?? 0 };
}

export async function getAgentsNeedingAttention(organizationId: string, limit = 5) {
  return prisma.agent.findMany({
    where: { organizationId, status: { in: ["NEEDS_ATTENTION", "PAUSED"] } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export async function listAllAgentsForOrg(organizationId: string) {
  return prisma.agent.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
}
