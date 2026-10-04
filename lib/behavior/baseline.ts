import "server-only";

import type { AgentBaseline, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { LEARNING_WINDOW_DAYS, METHODOLOGY_VERSION, NON_LEARNABLE_STATUSES, VOLUME_RULE } from "@/lib/behavior/config";
import { buildProfile, type CategoricalRow } from "@/lib/behavior/profile";
import { rollUpClosedHours, sqlTimestamp, startOfUtcDay } from "@/lib/behavior/rollup";
import type { BaselineSnapshot, BehaviorProfile } from "@/lib/behavior/types";

/**
 * Persistent, versioned per-agent baselines (P2). Replaces the former
 * seven-day, recompute-on-every-read calculation (lib/security/baseline.ts).
 *
 * Learning window: the LEARNING_WINDOW_DAYS full UTC days ending at the start
 * of today. Today's events are never part of the baseline they're compared
 * against, so a burst can't immediately redefine "normal". A new baseline
 * version is appended at most once per UTC day (when the window moves);
 * between days the latest version is reused.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 } as const;

export function learningWindow(now: Date): { windowStart: Date; windowEnd: Date } {
  const windowEnd = startOfUtcDay(now);
  return { windowStart: new Date(windowEnd.getTime() - LEARNING_WINDOW_DAYS * DAY_MS), windowEnd };
}

export function toSnapshot(baseline: Pick<AgentBaseline, "version" | "maturity" | "profile">): BaselineSnapshot {
  return { version: baseline.version, maturity: baseline.maturity, profile: baseline.profile as unknown as BehaviorProfile };
}

async function lockAgent(tx: Prisma.TransactionClient, agentId: string) {
  const lockKey = `behavior:${agentId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

/** Rollups up to the current closed hour (used by the history view). */
export async function ensureRollups(organizationId: string, agentId: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockAgent(tx, agentId);
    await rollUpClosedHours(tx, { organizationId, agentId, now });
  }, TX_OPTIONS);
}

/**
 * Returns the agent's current baseline, computing a new version first if the
 * latest one doesn't cover today's learning window. Serialized per agent
 * (advisory lock), so concurrent callers compute it once. Caller must have
 * verified the agent belongs to organizationId.
 */
export async function ensureBaseline(organizationId: string, agentId: string, now = new Date()): Promise<AgentBaseline> {
  const { windowStart, windowEnd } = learningWindow(now);

  const current = await prisma.agentBaseline.findFirst({
    where: { agentId, organizationId },
    orderBy: { version: "desc" },
  });
  if (current && current.windowEnd.getTime() === windowEnd.getTime() && current.methodologyVersion === METHODOLOGY_VERSION) {
    return current;
  }

  return prisma.$transaction(async (tx) => {
    await lockAgent(tx, agentId);

    // Someone else may have computed it while we waited for the lock.
    const latest = await tx.agentBaseline.findFirst({ where: { agentId, organizationId }, orderBy: { version: "desc" } });
    if (latest && latest.windowEnd.getTime() === windowEnd.getTime() && latest.methodologyVersion === METHODOLOGY_VERSION) {
      return latest;
    }

    await rollUpClosedHours(tx, { organizationId, agentId, now });

    const [categorical, hourlyTotals, frequencyOutliers, volumeRows] = await Promise.all([
      tx.$queryRaw<{ dimension: string; key: string; count: number; first_seen: string; last_seen: string; days_seen: number }[]>`
        SELECT "dimension", "key", SUM("count")::int AS count,
               to_char(MIN("hourStart"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_seen,
               to_char(MAX("hourStart"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_seen,
               COUNT(DISTINCT date_trunc('day', "hourStart"))::int AS days_seen
          FROM "agent_activity_rollups"
         WHERE "agentId" = ${agentId} AND "organizationId" = ${organizationId} AND "dimension" <> 'total'
           AND "hourStart" >= ${sqlTimestamp(windowStart)} AND "hourStart" < ${sqlTimestamp(windowEnd)}
         GROUP BY "dimension", "key"`,
      tx.agentActivityRollup.findMany({
        where: { agentId, organizationId, dimension: "total", hourStart: { gte: windowStart, lt: windowEnd } },
        select: { hourStart: true, count: true },
      }),
      tx.behavioralDeviation.findMany({
        where: { agentId, organizationId, kind: "UNUSUAL_FREQUENCY", day: { gte: new Date(windowStart.getTime() - DAY_MS), lt: windowEnd } },
        select: { dedupeKey: true },
      }),
      tx.activityEvent.findMany({
        where: {
          agentId,
          organizationId,
          timestamp: { gte: windowStart, lt: windowEnd },
          status: { notIn: [...NON_LEARNABLE_STATUSES] },
          OR: [{ recordCount: { not: null } }, { byteCount: { not: null } }],
        },
        select: { recordCount: true, byteCount: true },
        orderBy: { timestamp: "desc" },
        take: VOLUME_RULE.sampleLimit,
      }),
    ]);

    const rows: CategoricalRow[] = categorical.map((r) => ({
      dimension: r.dimension,
      key: r.key,
      count: Number(r.count),
      firstSeen: new Date(r.first_seen),
      lastSeen: new Date(r.last_seen),
      daysSeen: Number(r.days_seen),
    }));

    const built = buildProfile({
      windowStart,
      windowEnd,
      categorical: rows,
      hourlyTotals,
      excludedHours: new Set(frequencyOutliers.map((d) => d.dedupeKey.replace(/^hour:/, ""))),
      recordCounts: volumeRows.flatMap((v) => (v.recordCount !== null ? [v.recordCount] : [])),
      byteCounts: volumeRows.flatMap((v) => (v.byteCount !== null ? [v.byteCount] : [])),
    });

    const version = (latest?.version ?? 0) + 1;
    const created = await tx.agentBaseline.create({
      data: {
        organizationId,
        agentId,
        version,
        methodologyVersion: METHODOLOGY_VERSION,
        maturity: built.maturity,
        windowStart,
        windowEnd,
        eventsObserved: built.eventsObserved,
        activeDays: built.activeDays,
        activeHours: built.activeHours,
        profile: built.profile as unknown as Prisma.InputJsonValue,
        computedAt: now,
      },
    });
    await tx.agentBehaviorState.update({
      where: { agentId },
      data: { latestBaselineVersion: version, lastRefreshedAt: now },
    });
    return created;
  }, TX_OPTIONS);
}
