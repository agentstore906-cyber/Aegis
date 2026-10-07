/**
 * P2 — behavioral memory, end to end against the verified disposable test
 * database (lib/testing/test-db-guard.ts): rollups, versioned baselines,
 * learning behavior, detection through the real ingestion path, APIs,
 * tenant isolation, and historical integrity.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Agent, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createApiKey } from "@/lib/api-keys/repository";
import { drainDeferredTasks } from "@/lib/server/defer";
import { ensureBaseline, ensureRollups, toSnapshot } from "@/lib/behavior/baseline";
import { observeEventBehavior } from "@/lib/behavior/observe";
import { getBehaviorHistory, getBehaviorProfile, listBaselineVersions, listDeviations } from "@/lib/behavior/queries";
import { startOfUtcDay } from "@/lib/behavior/rollup";
import { POST as eventsHandler } from "@/app/api/v1/events/route";
import { GET as profileGet } from "@/app/api/v1/agents/[slug]/behavior/route";
import { GET as baselinesGet } from "@/app/api/v1/agents/[slug]/behavior/baselines/route";
import { GET as deviationsGet } from "@/app/api/v1/agents/[slug]/behavior/deviations/route";
import { GET as historyGet } from "@/app/api/v1/agents/[slug]/behavior/history/route";
import { GET as cronGet } from "@/app/api/internal/behavior/refresh/route";


// The cron route sweeps every organization by design. Scope the sweeps to this
// file's own organizations: otherwise the sweep races other test files'
// fixtures (pre-empting their baselines, hitting orgs torn down mid-run) and
// its cost grows with the size of the shared test database.
const cronScope = vi.hoisted(() => ({ organizationIds: [] as string[] }));
vi.mock("@/lib/behavior/refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/behavior/refresh")>();
  return { ...actual, refreshStaleBaselines: (o: Parameters<typeof actual.refreshStaleBaselines>[0]) => actual.refreshStaleBaselines({ ...o, organizationIds: cronScope.organizationIds }) };
});
vi.mock("@/lib/trust/refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trust/refresh")>();
  return { ...actual, refreshTrust: (o: Parameters<typeof actual.refreshTrust>[0]) => actual.refreshTrust({ ...o, organizationIds: cronScope.organizationIds }) };
});

const RUN_ID = `test_p2_${Date.now()}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const today = startOfUtcDay(new Date());

let orgA: { id: string };
let orgB: { id: string };
const keyPool: string[] = [];
let keyIndex = 0;
let keyNoBehaviorScope: string;
let keyB: string;
let keyBoundOther: string;
const agents: Record<string, Agent> = {};

const nextKey = () => keyPool[keyIndex++ % keyPool.length];
const ctx = { params: Promise.resolve<Record<string, string>>({}) };

async function track(agent: Agent, body: Record<string, unknown>) {
  const request = new Request("http://localhost/api/v1/events", {
    method: "POST",
    headers: { authorization: `Bearer ${nextKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ agent: agent.slug, eventType: "TOOL_CALL", action: "crm.read", ...body }),
  });
  const response = await eventsHandler(request, ctx);
  const json = await response.json();
  if (response.status >= 300) throw new Error(`track ${response.status} ${JSON.stringify(json)}`);
  await drainDeferredTasks();
  return json as { id: string };
}

function get(handler: typeof profileGet, slug: string, key: string, query = "") {
  return handler(
    new Request(`http://localhost/api/v1/agents/${slug}/behavior${query}`, { headers: { authorization: `Bearer ${key}` } }),
    { params: Promise.resolve({ slug }) }
  );
}

async function makeAgent(organizationId: string, slug: string) {
  return prisma.agent.create({
    data: { organizationId, name: slug, slug, owner: "Test", modelProvider: "Anthropic", modelName: "m" },
  });
}

/**
 * Regular history: `days` past days, UTC hours 09–17, two events per hour —
 * crm.read (parent) then crm.update (child) — via the crm tool/service to one
 * destination, 10 records each.
 */
async function seedHistory(agent: Agent, days: number, overrides: Partial<Prisma.ActivityEventCreateManyInput> = {}) {
  const rows: Prisma.ActivityEventCreateManyInput[] = [];
  for (let d = 1; d <= days; d += 1) {
    for (let h = 9; h <= 17; h += 1) {
      const base = today.getTime() - d * DAY + h * HOUR;
      const parentId = `${agent.id}-${d}-${h}-p`;
      const common = {
        organizationId: agent.organizationId,
        agentId: agent.id,
        eventType: "TOOL_CALL" as const,
        toolName: "CRM",
        toolKey: "crm",
        service: "crm-api",
        destination: "api.crm.example.com",
        destinationKind: "HOST" as const,
        dataClasses: ["INTERNAL" as const],
        recordCount: 10,
        status: "ALLOWED" as const,
        outcome: "SUCCESS" as const,
        environment: "PRODUCTION" as const,
        ...overrides,
      };
      rows.push({ ...common, id: parentId, action: "crm.read", timestamp: new Date(base + 5 * 60_000) });
      rows.push({ ...common, id: `${agent.id}-${d}-${h}-c`, action: "crm.update", parentEventId: parentId, timestamp: new Date(base + 10 * 60_000) });
    }
  }
  // Parents first: the FK on parentEventId requires them to exist.
  await prisma.activityEvent.createMany({ data: rows.filter((r) => !r.parentEventId) });
  await prisma.activityEvent.createMany({ data: rows.filter((r) => r.parentEventId) });
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "P2 A", slug: `${RUN_ID}-a` } });
  orgB = await prisma.organization.create({ data: { name: "P2 B", slug: `${RUN_ID}-b` } });
  cronScope.organizationIds = [orgA.id, orgB.id];
  for (const slug of ["established", "volume", "frequency", "evolution", "limited", "fresh", "integrity", "sequence"]) {
    agents[slug] = await makeAgent(orgA.id, `p2-${slug}`);
  }
  agents.other = await makeAgent(orgB.id, "p2-established"); // same slug, other tenant

  await seedHistory(agents.established, 20);
  await seedHistory(agents.volume, 20);
  await seedHistory(agents.frequency, 20);
  await seedHistory(agents.evolution, 20);
  await seedHistory(agents.integrity, 20);
  await seedHistory(agents.sequence, 20);
  await seedHistory(agents.limited, 4); // 72 events on 4 days -> LIMITED_HISTORY
  await seedHistory(agents.other, 20);

  for (let i = 0; i < 5; i += 1) keyPool.push((await createApiKey(orgA.id, null, { name: `k${i}`, environment: "TEST" })).raw);
  const noScope = await createApiKey(orgA.id, null, { name: "no-behavior-scope", environment: "TEST" });
  await prisma.apiKey.update({ where: { id: noScope.apiKey.id }, data: { scopes: ["events:write", "policy:evaluate", "approvals:read"] } });
  keyNoBehaviorScope = noScope.raw;
  keyB = (await createApiKey(orgB.id, null, { name: "b", environment: "TEST" })).raw;
  keyBoundOther = (await createApiKey(orgA.id, null, { name: "bound", environment: "TEST", agentId: agents.volume.id })).raw;
}, 120_000);

afterAll(async () => {
  await drainDeferredTasks();
  const orgIds = [orgA.id, orgB.id];
  // Deviations/baselines/rollups cascade with their agent; events first (FKs), then agents.
  await prisma.securityAlertOccurrence.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.behavioralDeviation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("baseline creation", () => {
  it("builds an ESTABLISHED, agent-specific profile from rollups of real history", async () => {
    const baseline = await ensureBaseline(orgA.id, agents.established.id);
    expect(baseline).toMatchObject({ maturity: "ESTABLISHED", version: 1, eventsObserved: 360, activeDays: 20, activeHours: 180 });
    expect(baseline.windowEnd.toISOString()).toBe(today.toISOString());

    const profile = toSnapshot(baseline).profile;
    expect(profile.dimensions.tool.established.map((e) => e.key)).toEqual(["crm"]);
    expect(profile.dimensions.destination.established[0]).toMatchObject({ key: "api.crm.example.com", count: 360, daysSeen: 20, share: 1 });
    expect(profile.dimensions.transition.established[0]).toMatchObject({ key: "crm.read>crm.update", count: 180 });
    expect(profile.dimensions.dataClass.established[0].key).toBe("INTERNAL");
    expect(profile.frequency.activeHour).toMatchObject({ n: 180, median: 2, p95: 2, max: 2 });
    expect(profile.volume.records).toMatchObject({ n: 360, median: 10, p95: 10, max: 10 });
    expect(profile.hourOfDay.filter((c) => c > 0)).toHaveLength(9);
    expect(profile.hourOfDay[3]).toBe(0);

    const state = await prisma.agentBehaviorState.findUniqueOrThrow({ where: { agentId: agents.established.id } });
    expect(state.latestBaselineVersion).toBe(1);
    expect(state.rollupThrough!.getTime()).toBeGreaterThanOrEqual(today.getTime());
  });

  it("is computed once per learning window — a second call reuses the same version", async () => {
    const again = await ensureBaseline(orgA.id, agents.established.id);
    expect(again.version).toBe(1);
    expect(await prisma.agentBaseline.count({ where: { agentId: agents.established.id } })).toBe(1);
  });

  it("concurrent first computations produce exactly one version", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => ensureBaseline(orgA.id, agents.sequence.id)));
    expect(new Set(results.map((r) => r.version))).toEqual(new Set([1]));
    expect(await prisma.agentBaseline.count({ where: { agentId: agents.sequence.id } })).toBe(1);
  });

  it("rollups are exact and idempotent: recomputing a range gives the same counts", async () => {
    const before = await prisma.agentActivityRollup.aggregate({
      where: { agentId: agents.established.id, dimension: "total" },
      _sum: { count: true, recordSum: true },
    });
    expect(before._sum).toMatchObject({ count: 360, recordSum: 3600 });
    await prisma.agentBehaviorState.update({ where: { agentId: agents.established.id }, data: { rollupThrough: null } });
    await ensureRollups(orgA.id, agents.established.id);
    const after = await prisma.agentActivityRollup.aggregate({
      where: { agentId: agents.established.id, dimension: "total" },
      _sum: { count: true, recordSum: true },
    });
    expect(after._sum).toEqual(before._sum);
  });
});

describe("cold start", () => {
  it("a brand-new agent is NEW_AGENT and nothing is flagged — even a never-seen destination", async () => {
    await track(agents.fresh, { destination: "anything.example.com", tool: "whatever" });
    const profile = await getBehaviorProfile(orgA.id, agents.fresh.id);
    expect(profile!.baseline.maturity).toBe("NEW_AGENT");
    expect(await prisma.behavioralDeviation.count({ where: { agentId: agents.fresh.id } })).toBe(0);
  });

  it("LIMITED_HISTORY flags first-time values at LOW confidence but makes no statistical claims", async () => {
    await track(agents.limited, { tool: "shell", recordCount: 5_000_000 });
    const baseline = await prisma.agentBaseline.findFirstOrThrow({ where: { agentId: agents.limited.id } });
    expect(baseline.maturity).toBe("LIMITED_HISTORY");
    const deviations = await prisma.behavioralDeviation.findMany({ where: { agentId: agents.limited.id } });
    expect(deviations.map((d) => d.kind)).toContain("NEW_TOOL");
    expect(deviations.map((d) => d.kind)).not.toContain("UNUSUAL_VOLUME");
    expect(deviations.every((d) => d.confidence === "LOW")).toBe(true);
  });
});

describe("detection through the real ingestion path", () => {
  it("new tool and new destination, explained, linked to the event, deduplicated per day", async () => {
    const first = await track(agents.established, { tool: "Shell Runner", destination: "https://files.example-share.io/up?t=1" });
    await track(agents.established, { tool: "crm", destination: "files.example-share.io" });

    const deviations = await prisma.behavioralDeviation.findMany({ where: { agentId: agents.established.id } });
    const destination = deviations.find((d) => d.kind === "NEW_DESTINATION")!;
    const tool = deviations.find((d) => d.kind === "NEW_TOOL")!;
    expect(destination).toMatchObject({ dedupeKey: "destination:files.example-share.io", occurrences: 2, eventId: first.id, baselineVersion: 1 });
    expect(destination.explanation).toContain('"files.example-share.io"');
    expect(destination.explanation).toContain("api.crm.example.com");
    expect(destination.expected).toMatchObject({ observations: 360, windowDays: 28 });
    expect(tool.dedupeKey).toBe("tool:shell-runner");
    expect(tool.occurrences).toBe(1);
  });

  it("ordinary behavior records nothing new", async () => {
    const before = await prisma.behavioralDeviation.count({ where: { agentId: agents.volume.id } });
    await track(agents.volume, { tool: "CRM", service: "crm-api", destination: "api.crm.example.com", dataClasses: ["INTERNAL"], recordCount: 12 });
    const after = await prisma.behavioralDeviation.findMany({ where: { agentId: agents.volume.id } });
    // Only an UNUSUAL_TIME deviation is possible here, if this test happens to run outside 09–17 UTC.
    expect(after.filter((d) => d.kind !== "UNUSUAL_TIME")).toHaveLength(before);
  });

  it("unusual volume", async () => {
    await track(agents.volume, { tool: "CRM", destination: "api.crm.example.com", recordCount: 48_000 });
    const [volume] = await prisma.behavioralDeviation.findMany({ where: { agentId: agents.volume.id, kind: "UNUSUAL_VOLUME" } });
    expect(volume.observed).toMatchObject({ unit: "records", value: 48_000 });
    expect(volume.expected).toMatchObject({ median: 10, p95: 10, threshold: 30 });
    expect(volume.explanation).toContain("48,000 records");
  });

  it("unusual frequency", async () => {
    const now = new Date();
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        organizationId: orgA.id,
        agentId: agents.frequency.id,
        eventType: "TOOL_CALL" as const,
        action: "crm.read",
        toolKey: "crm",
        timestamp: new Date(Math.max(now.getTime() - i * 1000, now.getTime() - (now.getTime() % HOUR))),
      })),
    });
    await track(agents.frequency, { tool: "crm" });
    const [frequency] = await prisma.behavioralDeviation.findMany({ where: { agentId: agents.frequency.id, kind: "UNUSUAL_FREQUENCY" } });
    expect((frequency.observed as { events: number }).events).toBeGreaterThanOrEqual(41);
    expect(frequency.expected).toMatchObject({ median: 2, p95: 2, threshold: 22 });
  });

  it("unusual time and unusual sequence", async () => {
    const at3am = new Date(today.getTime() + 3 * HOUR + 60_000);
    const parent = await prisma.activityEvent.create({
      data: { organizationId: orgA.id, agentId: agents.sequence.id, eventType: "TOOL_CALL", action: "crm.read", toolKey: "crm", timestamp: at3am },
    });
    const child = await prisma.activityEvent.create({
      data: {
        organizationId: orgA.id,
        agentId: agents.sequence.id,
        eventType: "TOOL_CALL",
        action: "files.upload",
        toolKey: "crm",
        parentEventId: parent.id,
        timestamp: at3am,
      },
    });
    const found = await observeEventBehavior(orgA.id, agents.sequence.id, child.id, new Date(today.getTime() + 12 * HOUR));
    const kinds = found.map((d) => d.kind);
    expect(kinds).toContain("UNUSUAL_TIME");
    expect(kinds).toContain("UNUSUAL_SEQUENCE");
    const sequence = found.find((d) => d.kind === "UNUSUAL_SEQUENCE")!;
    expect(sequence.observed).toMatchObject({ value: "crm.read>files.upload" });
    expect(sequence.explanation).toContain("crm.read>crm.update");
  });
});

describe("baseline evolution and outliers", () => {
  it("today never teaches itself; a value becomes normal only after repeat use on 2+ days", async () => {
    const day0 = today.getTime();
    const mk = (offsetMs: number, destination: string) =>
      prisma.activityEvent.create({
        data: {
          organizationId: orgA.id,
          agentId: agents.evolution.id,
          eventType: "TOOL_CALL",
          action: "crm.read",
          toolKey: "crm",
          destination,
          destinationKind: "HOST",
          timestamp: new Date(day0 + offsetMs),
        },
      });

    // Day 0: first use of a new destination -> flagged against v1.
    const e0 = await mk(12 * HOUR, "partner.example.com");
    let found = await observeEventBehavior(orgA.id, agents.evolution.id, e0.id, new Date(day0 + 13 * HOUR));
    expect(found.map((d) => d.kind)).toContain("NEW_DESTINATION");

    // Day 1: the baseline now covers day 0, but one use on one day isn't "normal" yet.
    const e1 = await mk(DAY + 12 * HOUR, "partner.example.com");
    await mk(DAY + 12 * HOUR + 60_000, "partner.example.com");
    await mk(DAY + 12 * HOUR + 120_000, "partner.example.com");
    found = await observeEventBehavior(orgA.id, agents.evolution.id, e1.id, new Date(day0 + DAY + 13 * HOUR));
    const provisional = found.find((d) => d.kind === "NEW_DESTINATION")!;
    expect(provisional.explanation).toContain("appeared only 1 time(s) on 1 day(s)");

    // Day 2: seen 4 times across 2 days -> established; no longer a deviation.
    const e2 = await mk(2 * DAY + 12 * HOUR, "partner.example.com");
    found = await observeEventBehavior(orgA.id, agents.evolution.id, e2.id, new Date(day0 + 2 * DAY + 13 * HOUR));
    expect(found.map((d) => d.kind)).not.toContain("NEW_DESTINATION");

    const versions = await listBaselineVersions(orgA.id, agents.evolution.id);
    expect(versions!.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("a flagged burst hour is excluded from the next baseline's frequency statistics", async () => {
    const tomorrow = new Date(today.getTime() + DAY + 12 * HOUR);
    const next = await ensureBaseline(orgA.id, agents.frequency.id, tomorrow);
    const profile = toSnapshot(next).profile;
    expect(profile.frequency.excludedOutlierHours).toBe(1);
    expect(profile.frequency.activeHour).toMatchObject({ max: 2, p95: 2 });
  });

  it("one extreme volume event in history doesn't redefine normal volume", async () => {
    await prisma.activityEvent.create({
      data: {
        organizationId: orgA.id,
        agentId: agents.integrity.id,
        eventType: "TOOL_CALL",
        action: "crm.read",
        recordCount: 2_000_000,
        timestamp: new Date(today.getTime() - 3 * DAY + 10 * HOUR),
      },
    });
    const baseline = await ensureBaseline(orgA.id, agents.integrity.id);
    const records = toSnapshot(baseline).profile.volume.records!;
    expect(records.excludedOutliers).toBe(1);
    expect(records.max).toBe(10);
    expect(records.p95).toBe(10);
  });
});

describe("historical integrity", () => {
  it("baseline versions are immutable", async () => {
    const baseline = await ensureBaseline(orgA.id, agents.integrity.id);
    await expect(prisma.agentBaseline.update({ where: { id: baseline.id }, data: { maturity: "NEW_AGENT" } })).rejects.toThrow(/append-only/);
    await expect(prisma.agentBaseline.update({ where: { id: baseline.id }, data: { profile: {} } })).rejects.toThrow(/append-only/);
  });

  it("a deviation's explanation is immutable; only its repeat counters advance", async () => {
    const deviation = await prisma.behavioralDeviation.findFirstOrThrow({ where: { agentId: agents.established.id } });
    await expect(
      prisma.behavioralDeviation.update({ where: { id: deviation.id }, data: { explanation: "rewritten" } })
    ).rejects.toThrow(/append-only/);
    const otherKind = deviation.kind === "UNUSUAL_TIME" ? "NEW_TOOL" : "UNUSUAL_TIME";
    await expect(prisma.behavioralDeviation.update({ where: { id: deviation.id }, data: { kind: otherKind } })).rejects.toThrow(/append-only/);
    const bumped = await prisma.behavioralDeviation.update({
      where: { id: deviation.id },
      data: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
    });
    expect(bumped.occurrences).toBe(deviation.occurrences + 1);
  });

  it("deleting source events doesn't alter a computed baseline version", async () => {
    const before = await prisma.agentBaseline.findFirstOrThrow({ where: { agentId: agents.integrity.id }, orderBy: { version: "desc" } });
    await prisma.activityEvent.deleteMany({ where: { agentId: agents.integrity.id, recordCount: 2_000_000 } });
    const after = await prisma.agentBaseline.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.profile).toEqual(before.profile);
    expect(after.eventsObserved).toBe(before.eventsObserved);
  });
});

describe("APIs, authorization and tenant isolation", () => {
  it("profile, baselines, deviations and history endpoints", async () => {
    const key = nextKey();
    const profile = await (await get(profileGet, agents.established.slug, key)).json();
    expect(profile.baseline).toMatchObject({ maturity: "ESTABLISHED", version: 1 });
    expect(profile.profile.dimensions.tool.established[0].key).toBe("crm");
    expect(profile.recentDeviations.map((d: { kind: string }) => d.kind)).toContain("NEW_DESTINATION");

    const versions = await (await get(baselinesGet as typeof profileGet, agents.established.slug, key, "/baselines")).json();
    expect(versions.baselines[0]).toMatchObject({ version: 1, maturity: "ESTABLISHED" });
    const v1 = await (await get(baselinesGet as typeof profileGet, agents.established.slug, key, "/baselines?version=1")).json();
    expect(v1.profile.eventsObserved).toBe(360);
    expect((await get(baselinesGet as typeof profileGet, agents.established.slug, key, "/baselines?version=99")).status).toBe(404);

    const deviations = await (await get(deviationsGet as typeof profileGet, agents.established.slug, key, "/deviations?days=7")).json();
    expect(deviations.deviations[0]).toHaveProperty("explanation");
    expect((await get(deviationsGet as typeof profileGet, agents.established.slug, key, "/deviations?days=abc")).status).toBe(400);

    const history = await (await get(historyGet as typeof profileGet, agents.established.slug, key, "/history?days=7")).json();
    expect(history.history).toHaveLength(7);
    expect(history.history.slice(0, 6).every((d: { events: number }) => d.events === 18)).toBe(true);
  });

  it("requires the behavior:read scope", async () => {
    const response = await get(profileGet, agents.established.slug, keyNoBehaviorScope);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("an agent-bound key can only read its own agent's behavior", async () => {
    expect((await get(profileGet, agents.volume.slug, keyBoundOther)).status).toBe(200);
    const other = await get(profileGet, agents.established.slug, keyBoundOther);
    expect(other.status).toBe(403);
    expect((await other.json()).error.code).toBe("AGENT_NOT_AUTHORIZED");
  });

  it("another organization never sees this organization's behavior (same slug resolves to its own agent)", async () => {
    const response = await get(profileGet, "p2-volume", keyB);
    expect(response.status).toBe(404);
    const sameSlug = await (await get(profileGet, "p2-established", keyB)).json();
    expect(sameSlug.recentDeviations).toEqual([]);
    expect(sameSlug.profile.eventsObserved).toBe(360);

    expect(await getBehaviorProfile(orgB.id, agents.established.id)).toBeNull();
    expect(await listDeviations(orgB.id, agents.established.id)).toBeNull();
    expect(await listBaselineVersions(orgB.id, agents.established.id)).toBeNull();
    expect(await getBehaviorHistory(orgB.id, agents.established.id)).toBeNull();
  });
});

describe("scheduled refresh endpoint", () => {
  it("fails closed without CRON_SECRET, rejects a wrong secret, and refreshes with the right one", async () => {
    const saved = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await cronGet(new Request("http://localhost/api/internal/behavior/refresh"))).status).toBe(503);

      process.env.CRON_SECRET = "test-cron-secret-value";
      const wrong = await cronGet(new Request("http://localhost/x", { headers: { authorization: "Bearer nope" } }));
      expect(wrong.status).toBe(401);
      const ok = await cronGet(new Request("http://localhost/x", { headers: { authorization: "Bearer test-cron-secret-value" } }));
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body).toEqual(expect.objectContaining({ processed: expect.any(Number), failed: 0 }));
      expect(JSON.stringify(body)).not.toContain("crm");
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
  }, 120_000);
});
