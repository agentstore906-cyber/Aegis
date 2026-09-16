import "server-only";

import type { Budget, BudgetPeriod, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  getMonthSpendCentsForAgent,
  getOrgTodaySpendCents,
  getSpendSummary,
  getTodaySpendCentsForAgent,
} from "@/lib/costs/queries";
import { upsertAlertFinding } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

export class BudgetNotFoundError extends Error {
  constructor() {
    super("Budget not found.");
    this.name = "BudgetNotFoundError";
  }
}

export class DuplicateBudgetError extends Error {
  constructor() {
    super("A budget already exists for this scope and period.");
    this.name = "DuplicateBudgetError";
  }
}

export type BudgetInput = {
  agentId?: string | null;
  period: BudgetPeriod;
  limitCents: number;
  warningThresholdPercent: number;
};

const BUDGET_INCLUDE = { agent: { select: { id: true, name: true, slug: true } } } satisfies Prisma.BudgetInclude;
export type BudgetWithAgent = Prisma.BudgetGetPayload<{ include: typeof BUDGET_INCLUDE }>;

export async function listBudgets(organizationId: string): Promise<BudgetWithAgent[]> {
  return prisma.budget.findMany({
    where: { organizationId },
    include: BUDGET_INCLUDE,
    orderBy: [{ agentId: "asc" }, { period: "asc" }],
  });
}

export async function getBudget(organizationId: string, id: string): Promise<BudgetWithAgent | null> {
  return prisma.budget.findFirst({ where: { id, organizationId }, include: BUDGET_INCLUDE });
}

/**
 * No DB-level unique constraint covers (organizationId, agentId, period) —
 * Postgres treats NULL agentId as distinct per row, so it can't enforce
 * "at most one org-wide budget per period." Enforced here instead.
 */
async function assertNoDuplicateScope(
  organizationId: string,
  input: Pick<BudgetInput, "agentId" | "period">,
  excludeId?: string
) {
  const existing = await prisma.budget.findFirst({
    where: { organizationId, agentId: input.agentId ?? null, period: input.period, id: excludeId ? { not: excludeId } : undefined },
  });
  if (existing) throw new DuplicateBudgetError();
}

export async function createBudget(organizationId: string, createdById: string | null, input: BudgetInput): Promise<Budget> {
  await assertNoDuplicateScope(organizationId, input);
  return prisma.budget.create({
    data: {
      organizationId,
      createdById,
      agentId: input.agentId ?? null,
      period: input.period,
      limitCents: input.limitCents,
      warningThresholdPercent: input.warningThresholdPercent,
    },
  });
}

export async function updateBudget(organizationId: string, id: string, input: BudgetInput): Promise<Budget | null> {
  await assertNoDuplicateScope(organizationId, input, id);
  const result = await prisma.budget.updateMany({
    where: { id, organizationId },
    data: {
      agentId: input.agentId ?? null,
      period: input.period,
      limitCents: input.limitCents,
      warningThresholdPercent: input.warningThresholdPercent,
    },
  });
  if (result.count === 0) return null;
  return prisma.budget.findUnique({ where: { id } });
}

export async function deleteBudget(organizationId: string, id: string): Promise<boolean> {
  const result = await prisma.budget.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

async function spendForBudget(organizationId: string, agentId: string, period: BudgetPeriod): Promise<number> {
  if (period === "DAILY") return getTodaySpendCentsForAgent(organizationId, agentId);
  return getMonthSpendCentsForAgent(organizationId, agentId);
}

const PERIOD_LABEL: Record<BudgetPeriod, string> = { DAILY: "daily", MONTHLY: "monthly" };

/**
 * Checks only *agent-scoped* budgets (agentId set) against this agent's
 * current spend, called after every activity event — same "run inline,
 * cheap, indexed" shape as the other detectors in lib/security/detectors.ts.
 * Org-wide budgets (agentId null) are deliberately NOT checked here: a
 * SecurityAlert always belongs to exactly one agent, and attributing an
 * organization-wide overage to whichever agent's event happened to trigger
 * the check would misrepresent whose spending caused it. Org-wide budgets
 * are instead shown live on /costs (getOrgBudgetStatus below) — see
 * docs/cost-intelligence.md.
 *
 * Pure monitoring: exceeding a budget never blocks anything. Every alert
 * this raises says "alert triggered," never "spending blocked" — Aegis has
 * no mechanism to stop a model provider from billing an agent's own API key.
 */
export async function checkAgentBudgets(organizationId: string, agent: { id: string; name: string }): Promise<void> {
  const budgets = await prisma.budget.findMany({ where: { organizationId, agentId: agent.id } });
  if (budgets.length === 0) return;

  for (const budget of budgets) {
    if (budget.limitCents <= 0) continue;
    const spentCents = await spendForBudget(organizationId, agent.id, budget.period);
    const percent = (spentCents / budget.limitCents) * 100;
    const periodLabel = PERIOD_LABEL[budget.period];
    const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

    if (percent >= 100) {
      const { alert } = await upsertAlertFinding(organizationId, {
        type: SECURITY_ALERT_TYPES.BUDGET_EXCEEDED,
        severity: "HIGH",
        agentId: agent.id,
        title: `${agent.name} exceeded its ${periodLabel} budget — alert triggered`,
        description: `Spent ${formatDollars(spentCents)} of a ${formatDollars(
          budget.limitCents
        )} ${periodLabel} budget (${Math.round(percent)}%). Aegis has no mechanism to block this agent's spending — this is a monitoring alert, not an enforcement action.`,
        evidence: { spentCents, limitCents: budget.limitCents, period: budget.period, percent: Math.round(percent) },
        recommendedAction: "Review recent activity driving spend, or raise this agent's budget if the increase is expected.",
      });
      await dispatchWebhookEvent(organizationId, "budget.exceeded", {
        alertId: alert.id,
        agentId: agent.id,
        budgetId: budget.id,
        period: budget.period,
        spentCents,
        limitCents: budget.limitCents,
      });
    } else if (percent >= budget.warningThresholdPercent) {
      const { alert } = await upsertAlertFinding(organizationId, {
        type: SECURITY_ALERT_TYPES.BUDGET_WARNING,
        severity: "MEDIUM",
        agentId: agent.id,
        title: `${agent.name} is approaching its ${periodLabel} budget`,
        description: `Spent ${formatDollars(spentCents)} of a ${formatDollars(
          budget.limitCents
        )} ${periodLabel} budget (${Math.round(percent)}%, at or above the ${budget.warningThresholdPercent}% warning threshold).`,
        evidence: { spentCents, limitCents: budget.limitCents, period: budget.period, percent: Math.round(percent) },
      });
      await dispatchWebhookEvent(organizationId, "budget.warning", {
        alertId: alert.id,
        agentId: agent.id,
        budgetId: budget.id,
        period: budget.period,
        spentCents,
        limitCents: budget.limitCents,
      });
    }
  }
}

export type BudgetStatus = {
  budget: BudgetWithAgent;
  spentCents: number;
  percent: number;
  exceeded: boolean;
  warning: boolean;
};

/** Every budget in the org (agent-scoped and organization-wide) with its current spend — for the /costs budgets panel. */
export async function getAllBudgetStatuses(organizationId: string): Promise<BudgetStatus[]> {
  const budgets = await listBudgets(organizationId);
  if (budgets.length === 0) return [];

  const orgTodaySpendCents = budgets.some((b) => !b.agentId && b.period === "DAILY")
    ? await getOrgTodaySpendCents(organizationId)
    : 0;
  const orgSpendSummary = budgets.some((b) => !b.agentId && b.period === "MONTHLY")
    ? await getSpendSummary(organizationId)
    : null;

  return Promise.all(
    budgets.map(async (budget) => {
      const spentCents = budget.agentId
        ? await spendForBudget(organizationId, budget.agentId, budget.period)
        : budget.period === "DAILY"
          ? orgTodaySpendCents
          : (orgSpendSummary?.thisMonthCents ?? 0);
      const percent = budget.limitCents > 0 ? (spentCents / budget.limitCents) * 100 : 0;
      return {
        budget,
        spentCents,
        percent,
        exceeded: percent >= 100,
        warning: percent >= budget.warningThresholdPercent && percent < 100,
      };
    })
  );
}

