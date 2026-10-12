/**
 * Regression: retention must not make previously observed actions look "new" again. Real (test) database.
 * First-time detectors (new sensitive action / new tool / new namespace) must still fire for genuinely new things.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { purgeExpiredActivity } from "@/lib/retention/activity";
import { runSecurityDetectors } from "@/lib/security/evaluate";
import type { RiskLevel } from "@prisma/client";

const RUN = `retbase_${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

let orgId: string;
let agent: { id: string; name: string };

async function makeAgent(key: string) {
  return prisma.agent.create({
    data: { organizationId: orgId, name: key, slug: `${RUN}-${key}`, owner: "t", modelProvider: "x", modelName: "y" },
  });
}

/** Stores the event first (as ingestion does), then runs the detectors for it. */
async function scan(a: { id: string; name: string }, action: string, opts: { riskLevel?: RiskLevel; toolName?: string; at?: Date } = {}) {
  const riskLevel = opts.riskLevel ?? "LOW";
  await prisma.activityEvent.create({
    data: {
      organizationId: orgId,
      agentId: a.id,
      eventType: "TOOL_CALL",
      action,
      toolName: opts.toolName,
      toolKey: opts.toolName?.toLowerCase(),
      riskLevel,
      timestamp: opts.at ?? new Date(),
    },
  });
  await runSecurityDetectors({
    organizationId: orgId,
    agent: a,
    action,
    riskLevel,
    status: "ALLOWED",
    traceId: null,
    toolName: opts.toolName,
  });
}

const alertsFor = (agentId: string, type: string) => prisma.securityAlert.findMany({ where: { organizationId: orgId, agentId, type } });
const occurrences = async (agentId: string, type: string) =>
  prisma.securityAlertOccurrence.count({ where: { alert: { organizationId: orgId, agentId, type } } });
const resolveAll = (agentId: string) =>
  prisma.securityAlert.updateMany({ where: { organizationId: orgId, agentId }, data: { status: "RESOLVED", resolvedAt: new Date() } });

/** A real purge run that deletes everything past the Free window (agents are marked fully rolled up). */
async function purgeNow(a: { id: string }) {
  await prisma.agentBehaviorState.upsert({
    where: { agentId: a.id },
    create: { agentId: a.id, organizationId: orgId, rollupThrough: new Date() },
    update: { rollupThrough: new Date() },
  });
  return purgeExpiredActivity({ organizationIds: [orgId] });
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Retention baseline", slug: RUN, plan: "free" } });
  orgId = org.id;
  agent = await makeAgent("a1");
});

afterAll(async () => {
  await prisma.securityAlert.deleteMany({ where: { organizationId: orgId } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.agentActivityRollup.deleteMany({ where: { organizationId: orgId } });
  await prisma.agentBehaviorState.deleteMany({ where: { organizationId: orgId } });
  await prisma.agent.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe("NEW_SENSITIVE_ACTION across a retention purge", () => {
  it("still alerts for a genuinely new sensitive action, once", async () => {
    await scan(agent, "wire.send_all", { riskLevel: "CRITICAL" });
    expect(await alertsFor(agent.id, "NEW_SENSITIVE_ACTION")).toHaveLength(1);
    await scan(agent, "wire.send_all", { riskLevel: "CRITICAL" });
    expect(await occurrences(agent.id, "NEW_SENSITIVE_ACTION")).toBe(1);
  });

  it("does not re-fire after the old events are purged and the earlier alert was resolved", async () => {
    const a = await makeAgent("a2");
    await scan(a, "db.drop_table", { riskLevel: "CRITICAL", at: new Date(Date.now() - 10 * DAY) });
    expect(await occurrences(a.id, "NEW_SENSITIVE_ACTION")).toBe(1);
    await resolveAll(a.id);

    const purged = await purgeNow(a);
    expect(purged.events).toBeGreaterThanOrEqual(1);
    expect(await prisma.activityEvent.count({ where: { agentId: a.id } })).toBe(0); // the history really is gone

    await scan(a, "db.drop_table", { riskLevel: "CRITICAL" });
    expect(await alertsFor(a.id, "NEW_SENSITIVE_ACTION")).toHaveLength(1);
    expect(await occurrences(a.id, "NEW_SENSITIVE_ACTION")).toBe(1);
  });

  it("uses the behavior rollup as a baseline when no alert exists", async () => {
    const a = await makeAgent("a3");
    await prisma.agentActivityRollup.create({
      data: { organizationId: orgId, agentId: a.id, hourStart: new Date(Date.now() - 20 * DAY), dimension: "action", key: "files.shred", count: 4 },
    });
    await scan(a, "files.shred", { riskLevel: "HIGH" });
    expect(await alertsFor(a.id, "NEW_SENSITIVE_ACTION")).toHaveLength(0);
  });

  it("does not let another agent's or tenant's history suppress a first-time alert", async () => {
    const a = await makeAgent("a4");
    await scan(a, "wire.send_all", { riskLevel: "CRITICAL" }); // a1 already did this action
    expect(await alertsFor(a.id, "NEW_SENSITIVE_ACTION")).toHaveLength(1);
  });
});

describe("NEW_TOOL_USAGE across a retention purge", () => {
  it("fires for a new tool and namespace, then stays quiet after a purge", async () => {
    const a = await makeAgent("a5");
    await scan(a, "pay.charge", { toolName: "Stripe", at: new Date(Date.now() - 10 * DAY) });
    expect(await occurrences(a.id, "NEW_TOOL_USAGE")).toBe(1);
    await resolveAll(a.id);

    await purgeNow(a);
    expect(await prisma.activityEvent.count({ where: { agentId: a.id } })).toBe(0);

    await scan(a, "pay.refund", { toolName: "stripe" });
    expect(await occurrences(a.id, "NEW_TOOL_USAGE")).toBe(1);

    // No tool reported: the namespace fallback is also remembered.
    const b = await makeAgent("a6");
    await scan(b, "crm.read", { at: new Date(Date.now() - 10 * DAY) });
    expect(await occurrences(b.id, "NEW_TOOL_USAGE")).toBe(1);
    await resolveAll(b.id);
    await purgeNow(b);
    await scan(b, "crm.update");
    expect(await occurrences(b.id, "NEW_TOOL_USAGE")).toBe(1);
  });
});
