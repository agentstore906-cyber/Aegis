/**
 * Integration test against the real dev database — the baseline's minimum-
 * data gate and per-day math are query-layer guarantees, tested here
 * rather than against mocks. Modeled on lib/costs/__tests__/queries.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getAgentBehavioralBaseline } from "@/lib/security/baseline";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let sparseAgent: { id: string };
let richAgent: { id: string };
let noCostAgent: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Baseline Org A", slug: `${RUN_ID}-baseline-a` } });
  orgB = await prisma.organization.create({ data: { name: "Baseline Org B", slug: `${RUN_ID}-baseline-b` } });

  sparseAgent = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Sparse Agent",
      slug: `sparse-agent-${RUN_ID}`,
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  richAgent = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Rich Agent",
      slug: `rich-agent-${RUN_ID}`,
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  noCostAgent = await prisma.agent.create({
    data: {
      organizationId: orgB.id,
      name: "No Cost Agent",
      slug: `no-cost-agent-${RUN_ID}`,
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  // sparseAgent: only 3 events, all today — below both the event-count and
  // days-observed floors.
  await prisma.activityEvent.createMany({
    data: Array.from({ length: 3 }, () => ({
      organizationId: orgA.id,
      agentId: sparseAgent.id,
      eventType: "TOOL_CALL" as const,
      action: "crm.read",
      status: "ALLOWED" as const,
    })),
  });

  // richAgent: 4 days of real history (well past both floors), with a
  // deliberate, countable mix — 5 events/day for 4 days = 20 events, plus
  // one DATA_ACCESS, one delete-shaped action, one COMMUNICATION, one
  // FAILED, one BLOCKED each day, and $1.00 cost/day.
  const richEvents = [];
  for (let day = 0; day < 4; day += 1) {
    const timestamp = new Date(Date.now() - day * 24 * 60 * 60 * 1000);
    richEvents.push(
      { organizationId: orgA.id, agentId: richAgent.id, eventType: "DATA_ACCESS" as const, action: "crm.read", status: "ALLOWED" as const, timestamp, costCents: 100 },
      { organizationId: orgA.id, agentId: richAgent.id, eventType: "ACTION" as const, action: "record.delete", status: "ALLOWED" as const, timestamp },
      { organizationId: orgA.id, agentId: richAgent.id, eventType: "COMMUNICATION" as const, action: "email.send", status: "ALLOWED" as const, timestamp },
      { organizationId: orgA.id, agentId: richAgent.id, eventType: "ACTION" as const, action: "task.run", status: "FAILED" as const, timestamp },
      { organizationId: orgA.id, agentId: richAgent.id, eventType: "ACTION" as const, action: "task.run", status: "BLOCKED" as const, timestamp }
    );
  }
  await prisma.activityEvent.createMany({ data: richEvents });

  // noCostAgent: enough history to have a baseline, but never reports cost.
  await prisma.activityEvent.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      organizationId: orgB.id,
      agentId: noCostAgent.id,
      eventType: "TOOL_CALL" as const,
      action: "search.query",
      status: "ALLOWED" as const,
      timestamp: new Date(Date.now() - i * 12 * 60 * 60 * 1000), // spread over 6 days
    })),
  });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("getAgentBehavioralBaseline — insufficient data", () => {
  it("returns available: false for an agent with too little history", async () => {
    const baseline = await getAgentBehavioralBaseline(orgA.id, sparseAgent.id);
    expect(baseline.available).toBe(false);
    if (!baseline.available) {
      expect(baseline.eventsObserved).toBe(3);
    }
  });

  it("returns available: false with zero events, not an error, for a brand-new agent", async () => {
    const freshAgent = await prisma.agent.create({
      data: {
        organizationId: orgA.id,
        name: "Fresh Agent",
        slug: `fresh-agent-${RUN_ID}`,
        owner: "Test",
        modelProvider: "Anthropic",
        modelName: "test-model",
      },
    });
    const baseline = await getAgentBehavioralBaseline(orgA.id, freshAgent.id);
    expect(baseline.available).toBe(false);
    if (!baseline.available) {
      expect(baseline.eventsObserved).toBe(0);
      expect(baseline.daysObserved).toBe(0);
    }
  });
});

describe("getAgentBehavioralBaseline — calculation", () => {
  it("computes real per-day rates from an agent's own observed history", async () => {
    const baseline = await getAgentBehavioralBaseline(orgA.id, richAgent.id);
    expect(baseline.available).toBe(true);
    if (!baseline.available) return;

    expect(baseline.eventsObserved).toBe(20);
    expect(baseline.daysObserved).toBe(4);
    expect(baseline.eventsPerDay).toBe(5);
    expect(baseline.dataAccessPerDay).toBe(1);
    expect(baseline.destructiveActionsPerDay).toBe(1);
    expect(baseline.communicationsPerDay).toBe(1);
    expect(baseline.failedPerDay).toBe(1);
    expect(baseline.blockedPerDay).toBe(1);
    expect(baseline.costCentsPerDay).toBe(100);
  });

  it("distinguishes 'never reports cost' (null) from a real $0/day baseline", async () => {
    const baseline = await getAgentBehavioralBaseline(orgB.id, noCostAgent.id);
    expect(baseline.available).toBe(true);
    if (!baseline.available) return;
    expect(baseline.costCentsPerDay).toBeNull();
  });
});

describe("getAgentBehavioralBaseline — organization isolation", () => {
  it("returns insufficient data (not another org's history) when queried under the wrong organization", async () => {
    const baseline = await getAgentBehavioralBaseline(orgB.id, richAgent.id);
    expect(baseline.available).toBe(false);
    if (!baseline.available) {
      expect(baseline.eventsObserved).toBe(0);
    }
  });
});
