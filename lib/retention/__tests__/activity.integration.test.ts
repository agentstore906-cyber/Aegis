/**
 * Plan-based activity retention against the real (test) database. Fixed `now`, explicit event timestamps.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { PLANS } from "@/lib/billing/plans";
import { purgeExpiredActivity } from "@/lib/retention/activity";

const RUN = `ret_${Date.now()}`;
const NOW = new Date("2026-10-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Org = { id: string };
const orgs: Record<string, Org> = {};
const agents: Record<string, { id: string }> = {};

async function makeOrg(key: string, plan: string) {
  orgs[key] = await prisma.organization.create({ data: { name: `Ret ${key}`, slug: `${RUN}-${key}`, plan } });
}
async function makeAgent(key: string, orgKey: string, opts: { status?: "ACTIVE" | "ARCHIVED"; rolledThrough?: Date | null } = {}) {
  const agent = await prisma.agent.create({
    data: { organizationId: orgs[orgKey].id, name: key, slug: `${RUN}-${key}`, owner: "t", modelProvider: "x", modelName: "y", status: opts.status ?? "ACTIVE" },
  });
  agents[key] = agent;
  if (opts.rolledThrough !== undefined) {
    await prisma.agentBehaviorState.create({ data: { agentId: agent.id, organizationId: orgs[orgKey].id, rollupThrough: opts.rolledThrough } });
  }
  return agent;
}
const event = (orgKey: string, agentKey: string, timestamp: Date, action = "t.act") =>
  prisma.activityEvent.create({ data: { organizationId: orgs[orgKey].id, agentId: agents[agentKey].id, eventType: "TOOL_CALL", action, timestamp } });
const countFor = (agentKey: string) => prisma.activityEvent.count({ where: { agentId: agents[agentKey].id } });
const purge = (orgKeys: string[], extra: Parameters<typeof purgeExpiredActivity>[0] = {}) =>
  purgeExpiredActivity({ now: NOW, organizationIds: orgKeys.map((k) => orgs[k].id), ...extra });

beforeAll(async () => {
  await makeOrg("free", "free");
  await makeOrg("startup", "startup");
  await makeOrg("growth", "growth");
  await makeOrg("legacy", "some-legacy-plan");
  await makeOrg("other-free", "free");
});

afterAll(async () => {
  const ids = Object.values(orgs).map((o) => o.id);
  await prisma.incident.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("Free (7 days)", () => {
  it("deletes only events strictly older than the cutoff and never anything newer", async () => {
    await makeAgent("f1", "free", { rolledThrough: NOW });
    const free = PLANS.free.activityRetentionDays * DAY;
    await event("free", "f1", ago(free + 1)); // 1 ms too old -> deleted
    await event("free", "f1", ago(free + 3 * DAY)); // old -> deleted
    await event("free", "f1", ago(free)); // exactly at the cutoff -> kept (strict <)
    await event("free", "f1", ago(free - 1)); // 1 ms inside -> kept
    await event("free", "f1", ago(DAY)); // recent -> kept
    await event("free", "f1", NOW); // now -> kept

    const result = await purge(["free"]);
    expect(result.events).toBe(2);
    expect(await countFor("f1")).toBe(4);
    const oldest = await prisma.activityEvent.findFirstOrThrow({ where: { agentId: agents.f1.id }, orderBy: { timestamp: "asc" } });
    expect(oldest.timestamp.getTime()).toBe(ago(free).getTime());
  });

  it("is idempotent", async () => {
    const result = await purge(["free"]);
    expect(result.events).toBe(0);
    expect(await countFor("f1")).toBe(4);
  });
});

describe("paid plans keep their longer windows", () => {
  it("Startup keeps 8-day-old events and deletes beyond 30 days; Growth keeps 31-day-old events", async () => {
    await makeAgent("s1", "startup", { rolledThrough: NOW });
    await makeAgent("g1", "growth", { rolledThrough: NOW });
    await event("startup", "s1", ago(8 * DAY));
    await event("startup", "s1", ago(30 * DAY - 1));
    await event("startup", "s1", ago(30 * DAY + 1)); // deleted
    await event("growth", "g1", ago(31 * DAY)); // kept (90-day window)
    await event("growth", "g1", ago(89 * DAY));

    const result = await purge(["startup", "growth"]);
    expect(result.events).toBe(1);
    expect(await countFor("s1")).toBe(2);
    expect(await countFor("g1")).toBe(2);
  });
});

describe("safety rules", () => {
  it("skips an organization whose plan string is unknown (never treats it as Free)", async () => {
    await makeAgent("l1", "legacy", { rolledThrough: NOW });
    await event("legacy", "l1", ago(100 * DAY));
    const result = await purge(["legacy"]);
    expect(result.organizationsSkippedUnknownPlan).toBe(1);
    expect(result.events).toBe(0);
    expect(await countFor("l1")).toBe(1);
  });

  it("keeps events the behavioral baseline has not rolled up yet, deleting only the rolled-up part", async () => {
    await makeAgent("h-never", "other-free", {}); // no behavior state at all
    await makeAgent("h-behind", "other-free", { rolledThrough: ago(10 * DAY) });
    await event("other-free", "h-never", ago(20 * DAY));
    await event("other-free", "h-behind", ago(20 * DAY)); // before rollupThrough and before cutoff -> deleted
    await event("other-free", "h-behind", ago(9 * DAY)); // past the cutoff but NOT rolled up yet -> kept

    const result = await purge(["other-free"]);
    expect(result.agentsHeldForRollup).toBe(1);
    expect(result.events).toBe(1);
    expect(await countFor("h-never")).toBe(1);
    expect(await countFor("h-behind")).toBe(1);
  });

  it("does not hold back an archived agent that has no baseline", async () => {
    await makeAgent("arch", "other-free", { status: "ARCHIVED" });
    await event("other-free", "arch", ago(30 * DAY));
    await purge(["other-free"]);
    expect(await countFor("arch")).toBe(0);
  });

  it("dry run counts what would go and deletes nothing", async () => {
    await makeAgent("d1", "free", { rolledThrough: NOW });
    await event("free", "d1", ago(40 * DAY));
    await event("free", "d1", ago(1 * DAY));
    const dry = await purge(["free"], { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, events: 1 });
    expect(await countFor("d1")).toBe(2);
    const real = await purge(["free"]);
    expect(real.events).toBe(1);
    expect(await countFor("d1")).toBe(1);
  });

  it("works through batches", async () => {
    await makeAgent("b1", "free", { rolledThrough: NOW });
    for (let i = 0; i < 5; i++) await event("free", "b1", ago((20 + i) * DAY));
    await event("free", "b1", ago(DAY));
    const result = await purge(["free"], { batchSize: 2 });
    expect(result.events).toBe(5);
    expect(result.complete).toBe(true);
    expect(await countFor("b1")).toBe(1);
  });

  it("only touches the organizations it is asked about (tenant scoping)", async () => {
    await makeAgent("iso", "free", { rolledThrough: NOW });
    await event("free", "iso", ago(60 * DAY));
    const result = await purge(["growth"]); // growth keeps 90 days; free's old event must be untouched
    expect(result.events).toBe(0);
    expect(await countFor("iso")).toBe(1);
  });

  it("deleting an event that a policy evaluation points at is allowed by the append-only triggers (link is nulled)", async () => {
    await makeAgent("link", "free", { rolledThrough: NOW });
    const old = await event("free", "link", ago(30 * DAY));
    const evaluation = await prisma.policyEvaluation.create({
      data: { organizationId: orgs.free.id, agentId: agents.link.id, action: "t.act", decision: "ALLOW", reason: "test", activityEventId: old.id },
    });
    await purge(["free"]);
    expect(await countFor("link")).toBe(0);
    const kept = await prisma.policyEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
    expect(kept.activityEventId).toBeNull();
  });
});

describe("billing anomaly guard and downgrade grace period", () => {
  async function org(key: string, data: { plan: string; subscriptionStatus?: string | null; planDowngradedAt?: Date | null }) {
    orgs[key] = await prisma.organization.create({ data: { name: `Ret ${key}`, slug: `${RUN}-${key}`, ...data } });
    await makeAgent(`${key}-agent`, key, { rolledThrough: NOW });
    await event(key, `${key}-agent`, ago(30 * DAY)); // old enough for Free's 7-day window
    await event(key, `${key}-agent`, ago(DAY)); // always kept
  }

  it("an organization on Free with an active / trialing / past_due subscription is never purged (billing is wrong, not the customer's choice)", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      await org(`anomaly-${status}`, { plan: "free", subscriptionStatus: status });
      const result = await purge([`anomaly-${status}`]);
      expect(result).toMatchObject({ organizationsSkippedBillingAnomaly: 1, organizationsScanned: 0, events: 0 });
      expect(await countFor(`anomaly-${status}-agent`)).toBe(2);
    }
  });

  it("the guard holds in a dry run too, and a grace period cannot override it", async () => {
    await org("anomaly-grace", { plan: "free", subscriptionStatus: "active", planDowngradedAt: new Date(NOW.getTime() - 40 * DAY) });
    const dry = await purge(["anomaly-grace"], { dryRun: true });
    expect(dry).toMatchObject({ organizationsSkippedBillingAnomaly: 1, events: 0 });
    expect(await countFor("anomaly-grace-agent")).toBe(2);
  });

  it("a recent downgrade is protected for 14 days; afterwards the Free window applies", async () => {
    await org("grace", { plan: "free", subscriptionStatus: "cancelled", planDowngradedAt: ago(3 * DAY) });

    const inside = await purge(["grace"]);
    expect(inside).toMatchObject({ organizationsSkippedDowngradeGrace: 1, organizationsScanned: 0, events: 0 });
    expect(await countFor("grace-agent")).toBe(2);

    // Same organization, 15 days after the downgrade: nothing newer than the cutoff is ever touched.
    const later = new Date(NOW.getTime() + 12 * DAY); // downgrade was 3 days before NOW -> 15 days before `later`
    const after = await purgeExpiredActivity({ now: later, organizationIds: [orgs.grace.id] });
    expect(after).toMatchObject({ organizationsSkippedDowngradeGrace: 0, organizationsScanned: 1 });
    expect(after.events).toBe(2); // both events are now older than 7 days relative to `later`
  });

  it("a cancelled organization with no downgrade timestamp (or an expired one) gets normal Free retention", async () => {
    await org("legacy-free", { plan: "free", subscriptionStatus: "cancelled" });
    await org("old-downgrade", { plan: "free", subscriptionStatus: "cancelled", planDowngradedAt: ago(30 * DAY) });
    for (const key of ["legacy-free", "old-downgrade"]) {
      const result = await purge([key]);
      expect(result).toMatchObject({ organizationsScanned: 1, events: 1 });
      expect(await countFor(`${key}-agent`)).toBe(1);
    }
  });

  it("paid plans are unaffected by a stale downgrade timestamp", async () => {
    await org("paid-stale", { plan: "startup", subscriptionStatus: "active", planDowngradedAt: ago(DAY) });
    const result = await purge(["paid-stale"]);
    expect(result).toMatchObject({ organizationsScanned: 1, organizationsSkippedDowngradeGrace: 0, events: 0 }); // 30-day event is inside Startup's 30-day window
    expect(await countFor("paid-stale-agent")).toBe(2);
  });
});

describe("evidence behind retained alerts and incidents is never purged", () => {
  const traceEvent = (orgKey: string, agentKey: string, timestamp: Date, traceId: string | null) =>
    prisma.activityEvent.create({
      data: { organizationId: orgs[orgKey].id, agentId: agents[agentKey].id, eventType: "TOOL_CALL", action: "t.act", timestamp, traceId },
    });
  let incidentNumber = 0;
  const incident = (orgKey: string, agentKey: string, data: { anchorType: string; anchorId: string; traceId: string | null }) =>
    prisma.incident.create({
      data: {
        organizationId: orgs[orgKey].id,
        agentId: agents[agentKey].id,
        number: ++incidentNumber,
        clusterKey: `${data.anchorType}:${data.anchorId}`,
        title: "test incident",
        severity: "HIGH",
        openedVia: "MANUAL",
        ...data,
      },
    });
  const alert = (orgKey: string, agentKey: string, traceId: string | null) =>
    prisma.securityAlert.create({
      data: { organizationId: orgs[orgKey].id, agentId: agents[agentKey].id, type: "TEST", severity: "HIGH", title: "alert", description: "d", traceId },
    });

  beforeAll(async () => {
    await makeOrg("evidence", "free");
    await makeAgent("ev", "evidence", { rolledThrough: NOW });
  });

  it("keeps the whole run of an incident, its anchor event, an alert's run and an occurrence's run — and still deletes ordinary old events", async () => {
    const old = ago(30 * DAY);
    const plain = await traceEvent("evidence", "ev", old, "trace-plain");
    const noTrace = await traceEvent("evidence", "ev", old, null);
    const incRun1 = await traceEvent("evidence", "ev", old, "trace-incident");
    const incRun2 = await traceEvent("evidence", "ev", ago(29 * DAY), "trace-incident");
    const anchor = await traceEvent("evidence", "ev", old, null);
    const alertRun = await traceEvent("evidence", "ev", old, "trace-alert");
    const occRun = await traceEvent("evidence", "ev", old, "trace-occurrence");
    const evalEvent = await traceEvent("evidence", "ev", old, null);
    const recent = await traceEvent("evidence", "ev", ago(DAY), "trace-plain");

    await incident("evidence", "ev", { anchorType: "SECURITY_ALERT", anchorId: "alert-x", traceId: "trace-incident" });
    await incident("evidence", "ev", { anchorType: "ACTIVITY_EVENT", anchorId: anchor.id, traceId: null });
    await alert("evidence", "ev", "trace-alert");
    const occAlert = await alert("evidence", "ev", null);
    await prisma.securityAlertOccurrence.create({
      data: { organizationId: orgs.evidence.id, alertId: occAlert.id, severity: "HIGH", title: "o", description: "d", traceId: "trace-occurrence" },
    });
    const evaluation = await prisma.policyEvaluation.create({
      data: { organizationId: orgs.evidence.id, agentId: agents.ev.id, action: "t.act", decision: "BLOCK", reason: "r", activityEventId: evalEvent.id },
    });
    await incident("evidence", "ev", { anchorType: "POLICY_EVALUATION", anchorId: evaluation.id, traceId: null });

    // Dry run first: reports what it would keep, deletes nothing.
    const dry = await purge(["evidence"], { dryRun: true });
    expect(dry).toMatchObject({ events: 2, eventsPreservedForEvidence: 6 });
    expect(await countFor("ev")).toBe(9);

    const real = await purge(["evidence"]);
    expect(real).toMatchObject({ events: 2, eventsPreservedForEvidence: 6 });
    const left = new Set((await prisma.activityEvent.findMany({ where: { agentId: agents.ev.id }, select: { id: true } })).map((e) => e.id));
    for (const kept of [incRun1, incRun2, anchor, alertRun, occRun, evalEvent, recent]) expect(left.has(kept.id)).toBe(true);
    for (const gone of [plain, noTrace]) expect(left.has(gone.id)).toBe(false);
  });

  it("protection is per organization and agent: another tenant's identical trace id protects nothing here", async () => {
    await makeOrg("evidence-other", "free");
    await makeAgent("ev-other", "evidence-other", { rolledThrough: NOW });
    await makeAgent("ev-bystander", "evidence-other", { rolledThrough: NOW });
    await alert("evidence-other", "ev-other", "trace-shared");
    await traceEvent("evidence-other", "ev-bystander", ago(30 * DAY), "trace-shared"); // same trace id, different agent
    const result = await purge(["evidence-other"]);
    expect(result).toMatchObject({ events: 1, eventsPreservedForEvidence: 0 });
    expect(await countFor("ev-bystander")).toBe(0);
  });
});

describe("per-organization failure isolation", () => {
  it("a failing organization is reported and does not stop later organizations; counts stay truthful", async () => {
    const { vi } = await import("vitest");
    await makeOrg("iso-a", "free");
    await makeOrg("iso-b", "free");
    await makeOrg("iso-c", "free");
    // Ordered by id, so find which comes first/last and make the FIRST one fail.
    const ordered = ["iso-a", "iso-b", "iso-c"].sort((x, y) => (orgs[x].id < orgs[y].id ? -1 : 1));
    for (const key of ordered) {
      await makeAgent(`${key}-ag`, key, { rolledThrough: NOW });
      await event(key, `${key}-ag`, ago(PLANS.free.activityRetentionDays * DAY + DAY));
      await event(key, `${key}-ag`, ago(DAY));
    }
    const failing = ordered[0];

    const original = prisma.agent.findMany.bind(prisma.agent);
    const spy = vi.spyOn(prisma.agent, "findMany").mockImplementation(((args: { where?: { organizationId?: string } }) => {
      if (args?.where?.organizationId === orgs[failing].id) throw Object.assign(new Error("boom: SELECT secret_payload FROM x"), { code: "P2034" });
      return original(args as never);
    }) as never);
    try {
      const result = await purge(ordered);

      expect(result.organizationsFailed).toBe(1);
      expect(result.complete).toBe(false);
      expect(result.organizationsScanned).toBe(3);
      expect(result.failures).toEqual([{ organizationId: orgs[failing].id, errorName: "Error", errorCode: "P2034" }]);
      // Nothing sensitive: no message text anywhere in the result.
      expect(JSON.stringify(result)).not.toContain("secret_payload");
      expect(result.events).toBe(2); // the two healthy organizations each lost their one expired event

      // Failed org untouched; later orgs processed; no cross-tenant effect.
      expect(await countFor(`${failing}-ag`)).toBe(2);
      for (const key of ordered.slice(1)) expect(await countFor(`${key}-ag`)).toBe(1);
    } finally {
      spy.mockRestore();
    }

    // The failure was transient: the next run processes the organization normally.
    const retry = await purge(ordered);
    expect(retry.organizationsFailed).toBe(0);
    expect(retry.failures).toEqual([]);
    expect(retry.events).toBe(1);
    expect(retry.complete).toBe(true);
    expect(await countFor(`${failing}-ag`)).toBe(1);
  });

  it("a dry run with a failing organization still counts the others and deletes nothing", async () => {
    const { vi } = await import("vitest");
    await makeOrg("iso-d1", "free");
    await makeOrg("iso-d2", "free");
    const ordered = ["iso-d1", "iso-d2"].sort((x, y) => (orgs[x].id < orgs[y].id ? -1 : 1));
    for (const key of ordered) {
      await makeAgent(`${key}-ag`, key, { rolledThrough: NOW });
      await event(key, `${key}-ag`, ago(PLANS.free.activityRetentionDays * DAY + DAY));
    }
    const original = prisma.agent.findMany.bind(prisma.agent);
    const spy = vi.spyOn(prisma.agent, "findMany").mockImplementation(((args: { where?: { organizationId?: string } }) => {
      if (args?.where?.organizationId === orgs[ordered[0]].id) throw new Error("x");
      return original(args as never);
    }) as never);
    try {
      const result = await purge(ordered, { dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.organizationsFailed).toBe(1);
      expect(result.events).toBe(1);
      for (const key of ordered) expect(await countFor(`${key}-ag`)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("paused subscription hold", () => {
  async function pausedOrg(key: string, planDowngradedAt: Date | null) {
    orgs[key] = await prisma.organization.create({
      data: { name: `Ret ${key}`, slug: `${RUN}-${key}`, plan: "free", subscriptionStatus: "paused", planDowngradedAt },
    });
    await makeAgent(`${key}-agent`, key, { rolledThrough: NOW });
    await event(key, `${key}-agent`, ago(30 * DAY)); // far outside Free's 7-day window
    await event(key, `${key}-agent`, ago(DAY));
  }

  it("keeps a paused organization's history for 90 days — in dry run and delete mode — and reports the hold", async () => {
    await pausedOrg("paused-hold", ago(60 * DAY)); // well past the 14-day grace, inside the 90-day hold
    const dry = await purge(["paused-hold"], { dryRun: true });
    expect(dry).toMatchObject({ organizationsSkippedPausedHold: 1, organizationsScanned: 0, events: 0 });
    const real = await purge(["paused-hold"]);
    expect(real).toMatchObject({ organizationsSkippedPausedHold: 1, organizationsSkippedDowngradeGrace: 0, organizationsScanned: 0, events: 0 });
    expect(await countFor("paused-hold-agent")).toBe(2);
  });

  it("a paused organization with no recorded pause start deletes nothing and is counted separately", async () => {
    await pausedOrg("paused-noanchor", null);
    const result = await purge(["paused-noanchor"]);
    expect(result).toMatchObject({ organizationsSkippedPausedNoAnchor: 1, organizationsSkippedPausedHold: 0, organizationsScanned: 0, events: 0 });
    expect(await countFor("paused-noanchor-agent")).toBe(2);
  });

  it("after the 90-day cap, normal Free retention applies (only events past the Free window go)", async () => {
    await pausedOrg("paused-expired", ago(91 * DAY));
    const result = await purge(["paused-expired"]);
    expect(result).toMatchObject({ organizationsSkippedPausedHold: 0, organizationsScanned: 1, events: 1 });
    expect(await countFor("paused-expired-agent")).toBe(1); // the day-old event stays
  });

  it("the hold is tenant-scoped: a held organization does not shield another organization", async () => {
    await pausedOrg("paused-a", ago(10 * DAY));
    await makeOrg("not-paused", "free");
    await makeAgent("np-agent", "not-paused", { rolledThrough: NOW });
    await event("not-paused", "np-agent", ago(30 * DAY));
    const result = await purge(["paused-a", "not-paused"]);
    expect(result).toMatchObject({ organizationsSkippedPausedHold: 1, organizationsScanned: 1, events: 1 });
    expect(await countFor("paused-a-agent")).toBe(2);
    expect(await countFor("np-agent")).toBe(0);
  });
});
