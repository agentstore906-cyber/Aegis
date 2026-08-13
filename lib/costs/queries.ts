import "server-only";

import { prisma } from "@/lib/db";

/**
 * Cost intelligence is query-time aggregation over ActivityEvent's
 * existing cost/token columns — deliberately no separate CostEvent table
 * or rollup. See docs/cost-intelligence.md for why, and for the scale at
 * which that stops being true (large enough ActivityEvent volume that
 * these aggregates get slow — not the case yet).
 *
 * All time-window math here is in UTC (spec §34); only the UI localizes.
 */

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1));
}

export async function getTodaySpendCentsForAgent(organizationId: string, agentId: string): Promise<number> {
  const since = startOfUtcDay(new Date());
  const result = await prisma.activityEvent.aggregate({
    where: { organizationId, agentId, timestamp: { gte: since }, costCents: { not: null } },
    _sum: { costCents: true },
  });
  return result._sum.costCents ?? 0;
}

/** Average daily spend over the 7 days before today — excludes today itself so a spike can't dilute its own baseline. */
export async function getTrailingDailyAverageCentsForAgent(organizationId: string, agentId: string): Promise<number> {
  const todayStart = startOfUtcDay(new Date());
  const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.activityEvent.aggregate({
    where: { organizationId, agentId, timestamp: { gte: sevenDaysAgo, lt: todayStart }, costCents: { not: null } },
    _sum: { costCents: true },
  });

  return (result._sum.costCents ?? 0) / 7;
}

// ---------------------------------------------------------------------------
// /costs dashboard
// ---------------------------------------------------------------------------

export type SpendSummary = {
  thisMonthCents: number;
  previousMonthCents: number;
  /** null when there's no previous-period spend to compare against — never a fabricated 0%/∞. */
  changePercent: number | null;
  todayCents: number;
};

export async function getSpendSummary(organizationId: string): Promise<SpendSummary> {
  const now = new Date();
  const startThisMonth = startOfUtcMonth(now);
  const startPreviousMonth = startOfUtcMonth(now, -1);
  const startToday = startOfUtcDay(now);

  const [thisMonth, previousMonth, today] = await Promise.all([
    prisma.activityEvent.aggregate({
      where: { organizationId, timestamp: { gte: startThisMonth }, costCents: { not: null } },
      _sum: { costCents: true },
    }),
    prisma.activityEvent.aggregate({
      where: { organizationId, timestamp: { gte: startPreviousMonth, lt: startThisMonth }, costCents: { not: null } },
      _sum: { costCents: true },
    }),
    prisma.activityEvent.aggregate({
      where: { organizationId, timestamp: { gte: startToday }, costCents: { not: null } },
      _sum: { costCents: true },
    }),
  ]);

  const thisMonthCents = thisMonth._sum.costCents ?? 0;
  const previousMonthCents = previousMonth._sum.costCents ?? 0;

  return {
    thisMonthCents,
    previousMonthCents,
    changePercent: previousMonthCents > 0 ? ((thisMonthCents - previousMonthCents) / previousMonthCents) * 100 : null,
    todayCents: today._sum.costCents ?? 0,
  };
}

export type AgentSpend = {
  agentId: string;
  agentName: string;
  agentSlug: string;
  teamName: string | null;
  spendCents: number;
  previousPeriodSpendCents: number;
  changePercent: number | null;
  eventCount: number;
  avgCostCents: number;
};

/** This-month spend per agent, with the same period-over-period comparison as getSpendSummary. */
export async function getSpendByAgent(organizationId: string): Promise<AgentSpend[]> {
  const now = new Date();
  const startThisMonth = startOfUtcMonth(now);
  const startPreviousMonth = startOfUtcMonth(now, -1);

  const [thisMonthGrouped, previousMonthGrouped, agents] = await Promise.all([
    prisma.activityEvent.groupBy({
      by: ["agentId"],
      where: { organizationId, timestamp: { gte: startThisMonth }, costCents: { not: null } },
      _sum: { costCents: true },
      _count: true,
    }),
    prisma.activityEvent.groupBy({
      by: ["agentId"],
      where: { organizationId, timestamp: { gte: startPreviousMonth, lt: startThisMonth }, costCents: { not: null } },
      _sum: { costCents: true },
    }),
    prisma.agent.findMany({
      where: { organizationId },
      select: { id: true, name: true, slug: true, team: { select: { name: true } } },
    }),
  ]);

  const previousByAgent = new Map(previousMonthGrouped.map((g) => [g.agentId, g._sum.costCents ?? 0]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return thisMonthGrouped
    .map((g) => {
      const agent = agentById.get(g.agentId);
      const spendCents = g._sum.costCents ?? 0;
      const previousPeriodSpendCents = previousByAgent.get(g.agentId) ?? 0;
      return {
        agentId: g.agentId,
        agentName: agent?.name ?? "Unknown agent",
        agentSlug: agent?.slug ?? "",
        teamName: agent?.team?.name ?? null,
        spendCents,
        previousPeriodSpendCents,
        changePercent:
          previousPeriodSpendCents > 0 ? ((spendCents - previousPeriodSpendCents) / previousPeriodSpendCents) * 100 : null,
        eventCount: g._count,
        avgCostCents: g._count > 0 ? Math.round(spendCents / g._count) : 0,
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);
}

export type LabeledSpend = { label: string; spendCents: number; eventCount: number };

async function getSpendByColumn(
  organizationId: string,
  column: "modelProvider" | "modelName" | "taskType"
): Promise<LabeledSpend[]> {
  const now = new Date();
  const startThisMonth = startOfUtcMonth(now);

  const grouped = await prisma.activityEvent.groupBy({
    by: [column],
    where: { organizationId, timestamp: { gte: startThisMonth }, costCents: { not: null }, [column]: { not: null } },
    _sum: { costCents: true },
    _count: true,
  });

  return grouped
    .map((g) => ({
      label: (g[column] as string | null) ?? "Unknown",
      spendCents: g._sum.costCents ?? 0,
      eventCount: g._count,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);
}

export const getSpendByProvider = (organizationId: string) => getSpendByColumn(organizationId, "modelProvider");
export const getSpendByModel = (organizationId: string) => getSpendByColumn(organizationId, "modelName");
export const getSpendByTaskType = (organizationId: string) => getSpendByColumn(organizationId, "taskType");

/** Only meaningful when at least one agent has a team assigned — otherwise the /costs page hides this breakdown entirely. */
export async function getSpendByTeam(organizationId: string): Promise<LabeledSpend[]> {
  const byAgent = await getSpendByAgent(organizationId);
  const withTeam = byAgent.filter((a) => a.teamName);
  if (withTeam.length === 0) return [];

  const totals = new Map<string, LabeledSpend>();
  for (const agent of withTeam) {
    const key = agent.teamName!;
    const existing = totals.get(key) ?? { label: key, spendCents: 0, eventCount: 0 };
    existing.spendCents += agent.spendCents;
    existing.eventCount += agent.eventCount;
    totals.set(key, existing);
  }

  return [...totals.values()].sort((a, b) => b.spendCents - a.spendCents);
}

/**
 * Average total cost of a "successful" task (any ActivityEvent under that
 * taskId resolved ALLOWED) for one agent, this month. Loads matching rows
 * into memory to group by taskId — fine at the ActivityEvent volumes this
 * runs at today; the first thing to revisit if that changes (see file
 * header). Returns null (never a fabricated number) when the agent has no
 * taskId-tagged events at all.
 */
export async function getCostPerSuccessfulTaskForAgent(organizationId: string, agentId: string): Promise<number | null> {
  const startThisMonth = startOfUtcMonth(new Date());

  const rows = await prisma.activityEvent.findMany({
    where: { organizationId, agentId, timestamp: { gte: startThisMonth }, taskId: { not: null }, costCents: { not: null } },
    select: { taskId: true, costCents: true, status: true },
  });
  if (rows.length === 0) return null;

  const byTask = new Map<string, { totalCents: number; hasSuccess: boolean }>();
  for (const row of rows) {
    const key = row.taskId as string;
    const entry = byTask.get(key) ?? { totalCents: 0, hasSuccess: false };
    entry.totalCents += row.costCents ?? 0;
    if (row.status === "ALLOWED") entry.hasSuccess = true;
    byTask.set(key, entry);
  }

  const successfulTasks = [...byTask.values()].filter((t) => t.hasSuccess);
  if (successfulTasks.length === 0) return null;

  const totalCents = successfulTasks.reduce((sum, t) => sum + t.totalCents, 0);
  return Math.round(totalCents / successfulTasks.length);
}
