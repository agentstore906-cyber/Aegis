/**
 * Integration test against the real dev database. Covers budget CRUD
 * (organization isolation, duplicate-scope rejection) and the budget-check
 * detector wired into the ingestion pipeline (lib/security/evaluate.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ingestActivityEvent } from "@/lib/activity/ingest";
import { drainDeferredTasks } from "@/lib/server/defer";

// Detectors/alerts/webhooks run after the response (lib/server/defer.ts);
// outside a request scope they start immediately and are drained here so
// assertions see their effects deterministically.
async function ingest(...args: Parameters<typeof ingestActivityEvent>) {
  const event = await ingestActivityEvent(...args);
  await drainDeferredTasks();
  return event;
}

import * as repo from "@/lib/costs/budgets";
import { DuplicateBudgetError } from "@/lib/costs/budgets";
import { canManageBudgets } from "@/lib/costs/authorization";
import type { EventIngestInput } from "@/lib/validation/api";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let agent: Agent;

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Budget Org", slug: `${RUN_ID}-org` } });
  agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      name: "Spendy Agent",
      slug: "spendy-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
});

afterAll(async () => {
  await drainDeferredTasks();
  await prisma.securityAlert.deleteMany({ where: { organizationId: org.id } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: org.id } });
  await prisma.budget.deleteMany({ where: { organizationId: org.id } });
  await prisma.agent.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("budget CRUD", () => {
  it("rejects a second budget for the same scope and period", async () => {
    const budget = await repo.createBudget(org.id, null, {
      agentId: agent.id,
      period: "DAILY",
      limitCents: 1000,
      warningThresholdPercent: 80,
    });

    await expect(
      repo.createBudget(org.id, null, { agentId: agent.id, period: "DAILY", limitCents: 2000, warningThresholdPercent: 80 })
    ).rejects.toThrow(DuplicateBudgetError);

    await repo.deleteBudget(org.id, budget.id);
  });

  it("never returns another organization's budgets", async () => {
    const budget = await repo.createBudget(org.id, null, {
      agentId: agent.id,
      period: "MONTHLY",
      limitCents: 5000,
      warningThresholdPercent: 80,
    });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Budget Org", slug: `${RUN_ID}-other` } });
    try {
      expect(await repo.getBudget(otherOrg.id, budget.id)).toBeNull();
      expect(await repo.deleteBudget(otherOrg.id, budget.id)).toBe(false);
      // Untouched by the cross-org delete attempt.
      expect(await repo.getBudget(org.id, budget.id)).not.toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
      await repo.deleteBudget(org.id, budget.id);
    }
  });

  it("only OWNER, ADMIN, and FINANCE can manage budgets", () => {
    expect(canManageBudgets("OWNER")).toBe(true);
    expect(canManageBudgets("ADMIN")).toBe(true);
    expect(canManageBudgets("FINANCE")).toBe(true);
    expect(canManageBudgets("ENGINEER")).toBe(false);
    expect(canManageBudgets("SECURITY")).toBe(false);
    expect(canManageBudgets("VIEWER")).toBe(false);
  });
});

describe("budget check — never claims spending was blocked", () => {
  it("raises BUDGET_EXCEEDED once spend crosses the limit, worded as an alert not an enforcement", async () => {
    const budget = await repo.createBudget(org.id, null, {
      agentId: agent.id,
      period: "DAILY",
      limitCents: 100, // $1.00
      warningThresholdPercent: 50,
    });

    try {
      const input: EventIngestInput = {
        agent: agent.slug,
        eventType: "ACTION",
        action: "model.call",
        status: "SUCCESS",
        cost: 2.0, // $2.00 — well over the $1.00 daily limit
      } as EventIngestInput;
      await ingest(org.id, agent, input);

      const alert = await prisma.securityAlert.findFirst({
        where: { organizationId: org.id, agentId: agent.id, type: "BUDGET_EXCEEDED" },
      });
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe("HIGH");
      expect(alert?.title).toMatch(/alert triggered/i);
      expect(alert?.description).toMatch(/no mechanism to block/i);
      expect(alert?.description).not.toMatch(/spending (was |is )?blocked/i);
    } finally {
      await repo.deleteBudget(org.id, budget.id);
    }
  });

  it("raises BUDGET_WARNING, not BUDGET_EXCEEDED, when only the warning threshold is crossed", async () => {
    const budget = await repo.createBudget(org.id, null, {
      agentId: agent.id,
      period: "DAILY",
      limitCents: 1000, // $10 — well above today's accumulated spend, so this can't also trip BUDGET_EXCEEDED
      warningThresholdPercent: 1, // trivially crossed by any nonzero spend
    });

    try {
      const input: EventIngestInput = {
        agent: agent.slug,
        eventType: "ACTION",
        action: "model.call",
        status: "SUCCESS",
        cost: 0.5,
        traceId: `${RUN_ID}-warning-case`,
      } as EventIngestInput;
      await ingest(org.id, agent, input);

      const alert = await prisma.securityAlert.findFirst({
        where: { organizationId: org.id, agentId: agent.id, type: "BUDGET_WARNING" },
      });
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe("MEDIUM");
    } finally {
      await repo.deleteBudget(org.id, budget.id);
    }
  });
});
