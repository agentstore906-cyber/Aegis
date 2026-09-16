/**
 * Integration test against the real dev database — pagination, filtering,
 * and organization isolation are fundamentally query-layer guarantees for
 * lib/activity/queries.ts, tested here rather than against mocks. Modeled
 * on lib/costs/__tests__/queries.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  getActivityByTraceId,
  getActivityEvent,
  getAgentActivity,
  listActivityEvents,
  listDistinctToolNames,
} from "@/lib/activity/queries";
import { activityFiltersSchema } from "@/lib/validation/activity";

const RUN_ID = `test_${Date.now()}`;

function filters(overrides: Partial<Record<string, unknown>> = {}) {
  return activityFiltersSchema.parse(overrides);
}

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string };
let agentB: { id: string };
let agentOther: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Activity Org A", slug: `${RUN_ID}-activity-a` } });
  orgB = await prisma.organization.create({ data: { name: "Activity Org B", slug: `${RUN_ID}-activity-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Activity Test Agent A",
      slug: "activity-test-agent-a",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentOther = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Activity Test Agent Other",
      slug: "activity-test-agent-other",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentB = await prisma.agent.create({
    data: {
      organizationId: orgB.id,
      name: "Activity Test Agent B",
      slug: "activity-test-agent-b",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  // 30 events for org A / agent A so pagination has more than one page at
  // the module's PAGE_SIZE (25), plus a mix of status/risk/eventType/tool
  // to filter on, plus one event for a second org-A agent and one for org B
  // to prove isolation both across agents and across organizations.
  const events = Array.from({ length: 30 }, (_, i) => ({
    organizationId: orgA.id,
    agentId: agentA.id,
    eventType: "TOOL_CALL" as const,
    action: "crm.contact.read",
    resource: `contact:${i}`,
    toolName: "CRM",
    status: "ALLOWED" as const,
    riskLevel: "LOW" as const,
    traceId: i === 0 ? `${RUN_ID}-trace` : undefined,
    // Spread over distinct timestamps so `orderBy: timestamp desc` is deterministic.
    timestamp: new Date(Date.now() - i * 1000),
  }));

  await prisma.activityEvent.createMany({ data: events });

  await prisma.activityEvent.create({
    data: {
      organizationId: orgA.id,
      agentId: agentA.id,
      eventType: "DATA_ACCESS",
      action: "crm.contact.delete",
      resource: "contact:blocked-one",
      toolName: "CRM",
      status: "BLOCKED",
      riskLevel: "HIGH",
      traceId: `${RUN_ID}-trace`,
      timestamp: new Date(Date.now() - 60_000),
    },
  });

  await prisma.activityEvent.create({
    data: {
      organizationId: orgA.id,
      agentId: agentOther.id,
      eventType: "ACTION",
      action: "email.send",
      resource: "customer:4821",
      toolName: "Gmail",
      status: "ALLOWED",
      riskLevel: "LOW",
      timestamp: new Date(Date.now() - 90_000),
    },
  });

  await prisma.activityEvent.create({
    data: {
      organizationId: orgB.id,
      agentId: agentB.id,
      eventType: "TOOL_CALL",
      action: "crm.contact.read",
      resource: "contact:org-b",
      toolName: "CRM",
      status: "ALLOWED",
      riskLevel: "LOW",
      timestamp: new Date(),
    },
  });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("listActivityEvents — organization isolation", () => {
  it("never returns another organization's events", async () => {
    const { events, total } = await listActivityEvents(orgB.id, filters());
    expect(total).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].organizationId).toBe(orgB.id);
  });

  it("returns only org A's events for org A, across both of its agents", async () => {
    const { total } = await listActivityEvents(orgA.id, filters());
    expect(total).toBe(32); // 30 baseline + 1 blocked + 1 for agentOther
  });
});

describe("listActivityEvents — pagination", () => {
  it("caps a page at the fixed page size and orders newest first", async () => {
    const { events, pageSize } = await listActivityEvents(orgA.id, filters({ page: 1 }));
    expect(events).toHaveLength(pageSize);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(events[i].timestamp.getTime());
    }
  });

  it("returns the remainder on the last page, with the correct pageCount", async () => {
    const { total, pageSize, pageCount } = await listActivityEvents(orgA.id, filters({ page: 1 }));
    const lastPage = await listActivityEvents(orgA.id, filters({ page: pageCount }));
    const expectedLastPageSize = total - pageSize * (pageCount - 1);
    expect(lastPage.events.length).toBe(expectedLastPageSize);
  });

  it("never loads more than one page's worth of rows into memory at once", async () => {
    const { events, pageSize } = await listActivityEvents(orgA.id, filters({ page: 1 }));
    expect(events.length).toBeLessThanOrEqual(pageSize);
  });
});

describe("listActivityEvents — filtering", () => {
  it("filters by agentId", async () => {
    const { total, events } = await listActivityEvents(orgA.id, filters({ agentId: agentOther.id }));
    expect(total).toBe(1);
    expect(events[0].agentId).toBe(agentOther.id);
  });

  it("filters by status", async () => {
    const { total, events } = await listActivityEvents(orgA.id, filters({ status: "BLOCKED" }));
    expect(total).toBe(1);
    expect(events[0].status).toBe("BLOCKED");
  });

  it("filters by riskLevel", async () => {
    const { total, events } = await listActivityEvents(orgA.id, filters({ riskLevel: "HIGH" }));
    expect(total).toBe(1);
    expect(events[0].riskLevel).toBe("HIGH");
  });

  it("filters by eventType", async () => {
    const { total } = await listActivityEvents(orgA.id, filters({ eventType: "DATA_ACCESS" }));
    expect(total).toBe(1);
  });

  it("filters by toolName", async () => {
    const { total } = await listActivityEvents(orgA.id, filters({ toolName: "Gmail" }));
    expect(total).toBe(1);
  });

  it("filters by free-text query across action/resource/description/toolName", async () => {
    const { total, events } = await listActivityEvents(orgA.id, filters({ q: "blocked-one" }));
    expect(total).toBe(1);
    expect(events[0].resource).toBe("contact:blocked-one");
  });

  it("combines filters with AND semantics", async () => {
    const { total } = await listActivityEvents(
      orgA.id,
      filters({ agentId: agentA.id, status: "BLOCKED", riskLevel: "HIGH" })
    );
    expect(total).toBe(1);

    const { total: none } = await listActivityEvents(
      orgA.id,
      filters({ agentId: agentOther.id, status: "BLOCKED" })
    );
    expect(none).toBe(0);
  });

  it("returns zero results, not an error, when no event matches", async () => {
    const { total, events } = await listActivityEvents(orgA.id, filters({ q: "no-such-resource-xyz" }));
    expect(total).toBe(0);
    expect(events).toHaveLength(0);
  });
});

describe("getActivityEvent — organization scoping", () => {
  it("returns an event that belongs to the requesting organization", async () => {
    const { events } = await listActivityEvents(orgB.id, filters());
    const found = await getActivityEvent(orgB.id, events[0].id);
    expect(found?.id).toBe(events[0].id);
  });

  it("returns null for an event that belongs to a different organization", async () => {
    const { events } = await listActivityEvents(orgB.id, filters());
    const found = await getActivityEvent(orgA.id, events[0].id);
    expect(found).toBeNull();
  });

  it("returns null for a nonexistent event id, never throwing", async () => {
    const found = await getActivityEvent(orgA.id, "nonexistent-id");
    expect(found).toBeNull();
  });
});

describe("getAgentActivity — agent + organization scoping", () => {
  it("only returns events for the requested agent within the requested organization", async () => {
    const activity = await getAgentActivity(orgA.id, agentOther.id, 15);
    expect(activity).toHaveLength(1);
    expect(activity[0].agentId).toBe(agentOther.id);
  });

  it("returns nothing for an agent scoped to a different organization", async () => {
    const activity = await getAgentActivity(orgA.id, agentB.id, 15);
    expect(activity).toHaveLength(0);
  });
});

describe("getActivityByTraceId", () => {
  it("groups events sharing a trace id, scoped to the organization, oldest first", async () => {
    const related = await getActivityByTraceId(orgA.id, `${RUN_ID}-trace`);
    expect(related.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < related.length; i += 1) {
      expect(related[i - 1].timestamp.getTime()).toBeLessThanOrEqual(related[i].timestamp.getTime());
    }
  });
});

describe("listDistinctToolNames", () => {
  it("returns only this organization's distinct, non-null tool names", async () => {
    const names = await listDistinctToolNames(orgA.id);
    expect(names).toContain("CRM");
    expect(names).toContain("Gmail");

    const orgBNames = await listDistinctToolNames(orgB.id);
    expect(orgBNames).not.toContain("Gmail");
  });
});
