import "server-only";

import type { BehavioralDeviationKind } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureBaseline, ensureRollups, toSnapshot } from "@/lib/behavior/baseline";
import { sqlTimestamp, startOfUtcDay } from "@/lib/behavior/rollup";
import { ROLLUP_RETENTION_DAYS } from "@/lib/behavior/config";

/**
 * Read side of behavioral memory. Every function takes the caller's
 * organizationId (from the session or the API key — never from input) and
 * returns null / [] for an agent outside that organization, so no query can
 * surface another tenant's behavior.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function agentInOrg(organizationId: string, agentId: string) {
  return prisma.agent.findFirst({ where: { id: agentId, organizationId }, select: { id: true } });
}

/** "What is normal for this agent?" — the current baseline (computed if stale) plus recent changes. */
export async function getBehaviorProfile(organizationId: string, agentId: string, now = new Date()) {
  if (!(await agentInOrg(organizationId, agentId))) return null;
  const baseline = await ensureBaseline(organizationId, agentId, now);
  const recentDeviations = await listDeviations(organizationId, agentId, { days: 7, limit: 20 }, now);
  return {
    baseline: {
      version: baseline.version,
      methodologyVersion: baseline.methodologyVersion,
      maturity: baseline.maturity,
      windowStart: baseline.windowStart,
      windowEnd: baseline.windowEnd,
      eventsObserved: baseline.eventsObserved,
      activeDays: baseline.activeDays,
      activeHours: baseline.activeHours,
      computedAt: baseline.computedAt,
    },
    profile: toSnapshot(baseline).profile,
    recentDeviations: recentDeviations ?? [],
  };
}

/** Baseline version history (metadata only; each version is immutable). */
export async function listBaselineVersions(organizationId: string, agentId: string, limit = 30) {
  if (!(await agentInOrg(organizationId, agentId))) return null;
  return prisma.agentBaseline.findMany({
    where: { organizationId, agentId },
    orderBy: { version: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      version: true,
      methodologyVersion: true,
      maturity: true,
      windowStart: true,
      windowEnd: true,
      eventsObserved: true,
      activeDays: true,
      activeHours: true,
      computedAt: true,
    },
  });
}

/** One full historical baseline version, exactly as it was computed. */
export async function getBaselineVersion(organizationId: string, agentId: string, version: number) {
  return prisma.agentBaseline.findFirst({ where: { organizationId, agentId, version } });
}

export async function listDeviations(
  organizationId: string,
  agentId: string,
  options: { days?: number; limit?: number; kind?: BehavioralDeviationKind } = {},
  now = new Date()
) {
  if (!(await agentInOrg(organizationId, agentId))) return null;
  const days = Math.min(Math.max(options.days ?? 7, 1), ROLLUP_RETENTION_DAYS);
  return prisma.behavioralDeviation.findMany({
    where: {
      organizationId,
      agentId,
      lastSeenAt: { gte: new Date(now.getTime() - days * DAY_MS) },
      ...(options.kind ? { kind: options.kind } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
  });
}

export type BehaviorHistoryDay = {
  day: string;
  events: number;
  records: number;
  bytes: number;
  distinctTools: number;
  distinctDestinations: number;
  deviations: number;
};

/** Historical behavior: one row per UTC day from the hourly rollups (closed hours), oldest first. */
export async function getBehaviorHistory(organizationId: string, agentId: string, days = 28, now = new Date()) {
  if (!(await agentInOrg(organizationId, agentId))) return null;
  await ensureRollups(organizationId, agentId, now);
  const span = Math.min(Math.max(days, 1), ROLLUP_RETENTION_DAYS);
  const since = new Date(startOfUtcDay(now).getTime() - (span - 1) * DAY_MS);

  const [rows, deviations] = await Promise.all([
    prisma.$queryRaw<
      { day: string; events: number; records: number; bytes: number; tools: number; destinations: number }[]
    >`
      SELECT to_char(date_trunc('day', "hourStart"), 'YYYY-MM-DD') AS day,
             COALESCE(SUM("count") FILTER (WHERE "dimension" = 'total'), 0)::int AS events,
             COALESCE(SUM("recordSum") FILTER (WHERE "dimension" = 'total'), 0)::float8 AS records,
             COALESCE(SUM("byteSum") FILTER (WHERE "dimension" = 'total'), 0)::float8 AS bytes,
             COUNT(DISTINCT "key") FILTER (WHERE "dimension" = 'tool')::int AS tools,
             COUNT(DISTINCT "key") FILTER (WHERE "dimension" = 'destination')::int AS destinations
        FROM "agent_activity_rollups"
       WHERE "agentId" = ${agentId} AND "organizationId" = ${organizationId} AND "hourStart" >= ${sqlTimestamp(since)}
       GROUP BY 1
       ORDER BY 1`,
    prisma.behavioralDeviation.groupBy({
      by: ["day"],
      where: { organizationId, agentId, day: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const deviationsByDay = new Map(deviations.map((d) => [d.day.toISOString().slice(0, 10), d._count._all]));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const history: BehaviorHistoryDay[] = [];
  for (let i = 0; i < span; i += 1) {
    const day = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(day);
    history.push({
      day,
      events: Number(row?.events ?? 0),
      records: Number(row?.records ?? 0),
      bytes: Number(row?.bytes ?? 0),
      distinctTools: Number(row?.tools ?? 0),
      distinctDestinations: Number(row?.destinations ?? 0),
      deviations: deviationsByDay.get(day) ?? 0,
    });
  }
  return history;
}
