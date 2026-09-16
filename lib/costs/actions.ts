"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageBudgets } from "@/lib/costs/authorization";
import * as repo from "@/lib/costs/budgets";
import { DuplicateBudgetError } from "@/lib/costs/budgets";
import { budgetSchema } from "@/lib/validation/budget";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

export type BudgetFormState = { error?: string };

function parseBudgetFormData(formData: FormData) {
  const parsed = budgetSchema.safeParse({
    agentId: formData.get("agentId") ?? "",
    period: formData.get("period"),
    limitDollars: formData.get("limitDollars"),
    warningThresholdPercent: formData.get("warningThresholdPercent") ?? "80",
  });
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid budget" };
  }
  return {
    success: true as const,
    data: {
      agentId: parsed.data.agentId || null,
      period: parsed.data.period,
      limitCents: Math.round(parsed.data.limitDollars * 100),
      warningThresholdPercent: parsed.data.warningThresholdPercent,
    },
  };
}

export async function createBudgetAction(_prevState: BudgetFormState, formData: FormData): Promise<BudgetFormState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBudgets(role)) {
    return { error: "You don't have permission to manage budgets." };
  }

  const parsed = parseBudgetFormData(formData);
  if (!parsed.success) return { error: parsed.error };

  if (parsed.data.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: parsed.data.agentId, organizationId: organization.id } });
    if (!agent) return { error: "Selected agent was not found in this organization." };
  }

  try {
    const budget = await repo.createBudget(organization.id, user.id, parsed.data);
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: budget.agentId,
      eventType: AUDIT_EVENT_TYPES.BUDGET_CREATED,
      entityType: "Budget",
      entityId: budget.id,
      action: "budget.create",
      metadata: { period: budget.period, limitCents: budget.limitCents, scope: budget.agentId ? "agent" : "organization" },
    });
  } catch (error) {
    if (error instanceof DuplicateBudgetError) return { error: error.message };
    throw error;
  }

  revalidatePath("/costs");
  return {};
}

export async function updateBudgetAction(
  budgetId: string,
  _prevState: BudgetFormState,
  formData: FormData
): Promise<BudgetFormState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBudgets(role)) {
    return { error: "You don't have permission to manage budgets." };
  }

  const parsed = parseBudgetFormData(formData);
  if (!parsed.success) return { error: parsed.error };

  try {
    const updated = await repo.updateBudget(organization.id, budgetId, parsed.data);
    if (!updated) return { error: "Budget not found." };
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: updated.agentId,
      eventType: AUDIT_EVENT_TYPES.BUDGET_UPDATED,
      entityType: "Budget",
      entityId: updated.id,
      action: "budget.update",
      metadata: { period: updated.period, limitCents: updated.limitCents },
    });
  } catch (error) {
    if (error instanceof DuplicateBudgetError) return { error: error.message };
    throw error;
  }

  revalidatePath("/costs");
  return {};
}

export async function deleteBudgetAction(budgetId: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBudgets(role)) {
    throw new Error("You don't have permission to manage budgets.");
  }

  const budget = await repo.getBudget(organization.id, budgetId);
  const deleted = await repo.deleteBudget(organization.id, budgetId);
  if (deleted && budget) {
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: budget.agentId,
      eventType: AUDIT_EVENT_TYPES.BUDGET_DELETED,
      entityType: "Budget",
      entityId: budget.id,
      action: "budget.delete",
      metadata: { period: budget.period, limitCents: budget.limitCents },
    });
  }

  revalidatePath("/costs");
}
