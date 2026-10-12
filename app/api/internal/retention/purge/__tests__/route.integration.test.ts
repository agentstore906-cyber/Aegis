/**
 * End-to-end through the real route handler and the real purge against the test database. The purge is wrapped only to
 * restrict it to this test's own organizations (so it cannot touch rows other test files created); everything else —
 * auth, mode resolution, dry-run default, billing guards, deletion — is the production code path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

const scope = vi.hoisted(() => ({ organizationIds: [] as string[] }));
vi.mock("@/lib/retention/activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/retention/activity")>();
  return {
    ...actual,
    purgeExpiredActivity: (options: Parameters<typeof actual.purgeExpiredActivity>[0] = {}) =>
      actual.purgeExpiredActivity({ ...options, organizationIds: scope.organizationIds }),
  };
});

import { GET } from "@/app/api/internal/retention/purge/route";

const RUN = `retroute_${Date.now()}`;
const SECRET = "retention-route-test-secret";
const DAY = 24 * 60 * 60 * 1000;
const orgIds: string[] = [];
const agents: Record<string, string> = {};

const call = (query = "", authorization: string | null = `Bearer ${SECRET}`) =>
  GET(new Request(`http://localhost/api/internal/retention/purge${query}`, { headers: authorization ? { authorization } : {} }));
const count = (key: string) => prisma.activityEvent.count({ where: { agentId: agents[key] } });

async function makeOrg(key: string, data: Record<string, unknown>) {
  const org = await prisma.organization.create({ data: { name: key, slug: `${RUN}-${key}`, ...data } });
  orgIds.push(org.id);
  const agent = await prisma.agent.create({ data: { organizationId: org.id, name: key, slug: `${RUN}-${key}`, owner: "t", modelProvider: "x", modelName: "y", status: "ARCHIVED" } });
  agents[key] = agent.id;
  // One event far outside every window, one recent.
  await prisma.activityEvent.create({ data: { organizationId: org.id, agentId: agent.id, eventType: "TOOL_CALL", action: "t.old", timestamp: new Date(Date.now() - 60 * DAY) } });
  await prisma.activityEvent.create({ data: { organizationId: org.id, agentId: agent.id, eventType: "TOOL_CALL", action: "t.new", timestamp: new Date(Date.now() - DAY) } });
}

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET;
  await makeOrg("free", { plan: "free" });
  await makeOrg("anomaly", { plan: "free", subscriptionStatus: "active" });
  await makeOrg("grace", { plan: "free", subscriptionStatus: "cancelled", planDowngradedAt: new Date(Date.now() - 2 * DAY) });
  scope.organizationIds = orgIds;
});

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  delete process.env.AEGIS_RETENTION_PURGE_ENABLED;
});

afterAll(async () => {
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("authentication fails closed and never reaches the purge", () => {
  it("503 without CRON_SECRET, 401 with no or wrong bearer — nothing is deleted or even counted", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("?mode=delete")).status).toBe(503);
    process.env.CRON_SECRET = SECRET;
    process.env.AEGIS_RETENTION_PURGE_ENABLED = "true";
    expect((await call("?mode=delete", null)).status).toBe(401);
    expect((await call("?mode=delete", "Bearer wrong")).status).toBe(401);
    expect(await count("free")).toBe(2);
  });
});

describe("the default request cannot delete", () => {
  it("no parameters: dry run, reports candidates, deletes nothing — even with delete enabled in the deployment", async () => {
    process.env.AEGIS_RETENTION_PURGE_ENABLED = "true";
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: "dry_run", dryRun: true });
    expect(body.events).toBeGreaterThanOrEqual(1);
    expect(await count("free")).toBe(2);
  });

  it("dryRun=0 / dryRun=false / a typo'd mode never delete", async () => {
    process.env.AEGIS_RETENTION_PURGE_ENABLED = "true";
    for (const q of ["?dryRun=0", "?dryRun=false", "?mode=Delete", "?mode=purge"]) await call(q);
    expect(await count("free")).toBe(2);
  });

  it("?mode=delete without the deployment switch is refused (409) and deletes nothing", async () => {
    const res = await call("?mode=delete");
    expect(res.status).toBe(409);
    expect(await count("free")).toBe(2);
  });
});

describe("explicit, enabled delete mode — and what still takes precedence over deletion", () => {
  it("deletes only the expired event of an ordinary Free org; billing anomaly and downgrade grace are skipped", async () => {
    process.env.AEGIS_RETENTION_PURGE_ENABLED = "true";
    const res = await call("?mode=delete");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "delete", dryRun: false, organizationsSkippedBillingAnomaly: 1, organizationsSkippedDowngradeGrace: 1 });
    expect(await count("free")).toBe(1); // the 60-day-old event is gone, the recent one stays
    expect(await count("anomaly")).toBe(2); // billing anomaly: never deleted
    expect(await count("grace")).toBe(2); // inside the 14-day grace period: never deleted
  });
});

describe("a failing organization is reported truthfully", () => {
  it("dry run: 500 with the failure listed (id + error class only) while other organizations are still processed", async () => {
    const original = prisma.agent.findMany.bind(prisma.agent);
    const spy = vi.spyOn(prisma.agent, "findMany").mockImplementation(((args: { where?: { organizationId?: string } }) => {
      if (args?.where?.organizationId === orgIds[0]) throw new Error("secret detail that must not leak");
      return original(args as never);
    }) as never);
    try {
      const res = await call();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({ mode: "dry_run", organizationsFailed: 1, complete: false });
      expect(body.failures).toEqual([{ organizationId: orgIds[0], errorName: "Error", errorCode: null }]);
      expect(JSON.stringify(body)).not.toContain("secret detail");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("paused-subscription counters", () => {
  it("reports organizationsSkippedPausedHold / organizationsSkippedPausedNoAnchor and deletes nothing for them", async () => {
    const extra: Record<string, string> = {};
    for (const [key, anchor] of [["held", new Date(Date.now() - 40 * DAY)], ["noanchor", null]] as const) {
      const org = await prisma.organization.create({
        data: { name: `paused-${key}`, slug: `${RUN}-paused-${key}`, plan: "free", subscriptionStatus: "paused", planDowngradedAt: anchor },
      });
      orgIds.push(org.id);
      const agent = await prisma.agent.create({
        data: { organizationId: org.id, name: key, slug: `${RUN}-paused-${key}`, owner: "t", modelProvider: "x", modelName: "y", status: "ARCHIVED" },
      });
      extra[key] = agent.id;
      await prisma.activityEvent.create({ data: { organizationId: org.id, agentId: agent.id, eventType: "TOOL_CALL", action: "t.old", timestamp: new Date(Date.now() - 60 * DAY) } });
    }
    scope.organizationIds = orgIds;

    process.env.AEGIS_RETENTION_PURGE_ENABLED = "true";
    const dry = await (await call()).json();
    expect(dry).toMatchObject({ dryRun: true, organizationsSkippedPausedHold: 1, organizationsSkippedPausedNoAnchor: 1 });

    const res = await call("?mode=delete");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "delete", organizationsSkippedPausedHold: 1, organizationsSkippedPausedNoAnchor: 1 });
    for (const agentId of Object.values(extra)) expect(await prisma.activityEvent.count({ where: { agentId } })).toBe(1);
  });
});
