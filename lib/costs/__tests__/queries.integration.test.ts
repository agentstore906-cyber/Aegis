/**
 * Integration test against the real dev database. Cost aggregation
 * correctness — including "no float drift" and date-range bucketing — is
 * fundamentally a query-layer guarantee, tested here rather than against
 * mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  getCostPerSuccessfulTaskForAgent,
  getSpendByAgent,
  getSpendByModel,
  getSpendByProvider,
  getSpendSummary,
} from "@/lib/costs/queries";

const RUN_ID = `test_${Date.now()}`;

function startOfUtcMonth(date: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1));
}

// Two days into the current/previous UTC month — always a valid date, avoids flakiness around month boundaries.
const THIS_MONTH_TS = new Date(startOfUtcMonth(new Date()).getTime() + 2 * 24 * 60 * 60 * 1000);
const PREVIOUS_MONTH_TS = new Date(startOfUtcMonth(new Date(), -1).getTime() + 2 * 24 * 60 * 60 * 1000);

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string };
let agentB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Costs Org A", slug: `${RUN_ID}-costs-a` } });
  orgB = await prisma.organization.create({ data: { name: "Costs Org B", slug: `${RUN_ID}-costs-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Costs Test Agent A",
      slug: "costs-test-agent-a",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentB = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Costs Test Agent B",
      slug: "costs-test-agent-b",
      owner: "Test",
      modelProvider: "OpenAI",
      modelName: "gpt-test",
    },
  });

  await prisma.activityEvent.createMany({
    data: [
      // Agent A: this month — 3 events summing to 333 cents (a value that would drift under naive float math)
      {
        organizationId: orgA.id,
        agentId: agentA.id,
        eventType: "MODEL_CALL",
        action: "task.run",
        status: "ALLOWED",
        timestamp: THIS_MONTH_TS,
        costCents: 111,
        modelProvider: "Anthropic",
        modelName: "test-model",
        taskId: "task-1",
      },
      {
        organizationId: orgA.id,
        agentId: agentA.id,
        eventType: "MODEL_CALL",
        action: "task.run",
        status: "ALLOWED",
        timestamp: THIS_MONTH_TS,
        costCents: 111,
        modelProvider: "Anthropic",
        modelName: "test-model",
        taskId: "task-1",
      },
      {
        organizationId: orgA.id,
        agentId: agentA.id,
        eventType: "MODEL_CALL",
        action: "task.run",
        status: "FAILED",
        timestamp: THIS_MONTH_TS,
        costCents: 111,
        modelProvider: "Anthropic",
        modelName: "test-model",
        taskId: "task-2", // never succeeds — excluded from "cost per successful task"
      },
      // Agent A: previous month
      {
        organizationId: orgA.id,
        agentId: agentA.id,
        eventType: "MODEL_CALL",
        action: "task.run",
        status: "ALLOWED",
        timestamp: PREVIOUS_MONTH_TS,
        costCents: 200,
        modelProvider: "Anthropic",
        modelName: "test-model",
      },
      // Agent A: event with no cost data at all — must not break aggregation
      {
        organizationId: orgA.id,
        agentId: agentA.id,
        eventType: "TOOL_CALL",
        action: "task.other",
        status: "ALLOWED",
        timestamp: THIS_MONTH_TS,
        costCents: null,
      },
      // Agent B: this month, different provider/model
      {
        organizationId: orgA.id,
        agentId: agentB.id,
        eventType: "MODEL_CALL",
        action: "task.run",
        status: "ALLOWED",
        timestamp: THIS_MONTH_TS,
        costCents: 500,
        modelProvider: "OpenAI",
        modelName: "gpt-test",
      },
    ],
  });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("getSpendSummary", () => {
  it("sums this month's spend precisely, with no floating-point drift", async () => {
    const summary = await getSpendSummary(orgA.id);
    // 111 + 111 + 111 (agent A) + 500 (agent B) = 833, an exact integer — never 832.9999999998
    expect(summary.thisMonthCents).toBe(833);
    expect(Number.isInteger(summary.thisMonthCents)).toBe(true);
  });

  it("buckets previous month's spend separately from this month's", async () => {
    const summary = await getSpendSummary(orgA.id);
    expect(summary.previousMonthCents).toBe(200);
  });

  it("computes a percentage change only when there is a previous-period baseline", async () => {
    const summary = await getSpendSummary(orgA.id);
    expect(summary.changePercent).not.toBeNull();
  });

  it("returns zero spend, not an error, for an organization with no cost data", async () => {
    const summary = await getSpendSummary(orgB.id);
    expect(summary.thisMonthCents).toBe(0);
    expect(summary.changePercent).toBeNull();
  });
});

describe("getSpendByAgent", () => {
  it("breaks down this month's spend per agent, sorted highest first", async () => {
    const byAgent = await getSpendByAgent(orgA.id);
    expect(byAgent[0].agentId).toBe(agentB.id); // 500 > 333
    expect(byAgent[0].spendCents).toBe(500);

    const agentARow = byAgent.find((a) => a.agentId === agentA.id);
    expect(agentARow?.spendCents).toBe(333);
    expect(agentARow?.eventCount).toBe(3); // the null-cost event is excluded from the cost aggregate
  });

  it("never includes another organization's agents", async () => {
    const byAgent = await getSpendByAgent(orgB.id);
    expect(byAgent).toHaveLength(0);
  });
});

describe("getSpendByProvider / getSpendByModel", () => {
  it("groups by provider", async () => {
    const byProvider = await getSpendByProvider(orgA.id);
    const anthropic = byProvider.find((p) => p.label === "Anthropic");
    const openai = byProvider.find((p) => p.label === "OpenAI");
    expect(anthropic?.spendCents).toBe(333);
    expect(openai?.spendCents).toBe(500);
  });

  it("groups by model", async () => {
    const byModel = await getSpendByModel(orgA.id);
    expect(byModel.find((m) => m.label === "gpt-test")?.spendCents).toBe(500);
  });
});

describe("getCostPerSuccessfulTaskForAgent", () => {
  it("returns null when the agent has no taskId-tagged events", async () => {
    const result = await getCostPerSuccessfulTaskForAgent(orgA.id, agentB.id);
    expect(result).toBeNull();
  });

  it("only counts tasks with at least one successful step, averaged across those tasks", async () => {
    // task-1: 111 + 111 = 222 total, ALLOWED -> counted. task-2: 111 total, FAILED-only -> excluded.
    const result = await getCostPerSuccessfulTaskForAgent(orgA.id, agentA.id);
    expect(result).toBe(222);
  });
});
