import type { BaselineMaturity } from "@prisma/client";

import {
  ESTABLISHED_KEY,
  LEARNING_WINDOW_DAYS,
  MATURITY_THRESHOLDS,
  MAX_KEYS_PER_DIMENSION,
  METHODOLOGY_VERSION,
  VOLUME_RULE,
} from "@/lib/behavior/config";
import { robustSummarize, summarize } from "@/lib/behavior/stats";
import { DIMENSIONS, type BehaviorProfile, type DimensionEntry, type DimensionName, type DimensionProfile } from "@/lib/behavior/types";

/**
 * Turns already-aggregated rollup data into a BehaviorProfile. Pure — the
 * queries live in lib/behavior/baseline.ts — so every statistic and every
 * cold-start rule is unit-tested directly.
 */

export type CategoricalRow = {
  dimension: string;
  key: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  daysSeen: number;
};

export type HourlyTotal = { hourStart: Date; count: number };

export type ProfileInput = {
  windowStart: Date;
  windowEnd: Date;
  categorical: CategoricalRow[];
  hourlyTotals: HourlyTotal[];
  /** ISO hour starts previously flagged UNUSUAL_FREQUENCY — excluded from frequency/time statistics. */
  excludedHours: ReadonlySet<string>;
  recordCounts: number[];
  byteCounts: number[];
};

const HOUR_MS = 60 * 60 * 1000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function classifyMaturity(activeDays: number, eventsObserved: number): BaselineMaturity {
  const { limited, established } = MATURITY_THRESHOLDS;
  if (activeDays < limited.minActiveDays || eventsObserved < limited.minEvents) return "NEW_AGENT";
  if (activeDays < established.minActiveDays || eventsObserved < established.minEvents) return "LIMITED_HISTORY";
  return "ESTABLISHED";
}

function buildDimension(rows: CategoricalRow[]): DimensionProfile {
  const observations = rows.reduce((sum, r) => sum + r.count, 0);
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const kept = sorted.slice(0, MAX_KEYS_PER_DIMENSION);
  const entries: DimensionEntry[] = kept.map((r) => ({
    key: r.key,
    count: r.count,
    share: observations > 0 ? Math.round((r.count / observations) * 10_000) / 10_000 : 0,
    daysSeen: r.daysSeen,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
  }));
  const isEstablished = (e: DimensionEntry) => e.count >= ESTABLISHED_KEY.minCount && e.daysSeen >= ESTABLISHED_KEY.minDaysSeen;
  return {
    observations,
    distinct: rows.length,
    highCardinality: rows.length > MAX_KEYS_PER_DIMENSION,
    established: entries.filter(isEstablished),
    provisional: entries.filter((e) => !isEstablished(e)),
  };
}

export function buildProfile(input: ProfileInput): {
  maturity: BaselineMaturity;
  eventsObserved: number;
  activeDays: number;
  activeHours: number;
  profile: BehaviorProfile;
} {
  const active = input.hourlyTotals.filter((h) => h.count > 0).sort((a, b) => a.hourStart.getTime() - b.hourStart.getTime());
  const eventsObserved = active.reduce((sum, h) => sum + h.count, 0);
  const activeDays = new Set(active.map((h) => dayKey(h.hourStart))).size;
  const activeHours = active.length;

  // Frequency and time-of-day learn only from hours that weren't themselves anomalies.
  const learnable = active.filter((h) => !input.excludedHours.has(h.hourStart.toISOString()));
  const perDay = new Map<string, number>();
  const hourOfDay = new Array<number>(24).fill(0);
  for (const h of learnable) {
    perDay.set(dayKey(h.hourStart), (perDay.get(dayKey(h.hourStart)) ?? 0) + h.count);
    hourOfDay[h.hourStart.getUTCHours()] += h.count;
  }

  const firstActivity = active[0]?.hourStart ?? null;
  const spanHours = firstActivity
    ? Math.max(1, Math.round((input.windowEnd.getTime() - firstActivity.getTime()) / HOUR_MS))
    : 0;

  const byDimension = new Map<string, CategoricalRow[]>();
  for (const row of input.categorical) {
    const list = byDimension.get(row.dimension) ?? [];
    list.push(row);
    byDimension.set(row.dimension, list);
  }
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((name) => [name, buildDimension(byDimension.get(name) ?? [])])
  ) as Record<DimensionName, DimensionProfile>;

  const profile: BehaviorProfile = {
    methodologyVersion: METHODOLOGY_VERSION,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    windowDays: LEARNING_WINDOW_DAYS,
    eventsObserved,
    activeDays,
    activeHours,
    firstActivityAt: firstActivity?.toISOString() ?? null,
    lastActivityAt: active.at(-1)?.hourStart.toISOString() ?? null,
    dimensions,
    frequency: {
      activeHour: summarize(learnable.map((h) => h.count)),
      activeDay: summarize([...perDay.values()]),
      activeHourShare: spanHours > 0 ? Math.round((activeHours / spanHours) * 10_000) / 10_000 : 0,
      excludedOutlierHours: active.length - learnable.length,
    },
    hourOfDay,
    volume: {
      records: robustSummarize(input.recordCounts, VOLUME_RULE.outlierMultiplier),
      bytes: robustSummarize(input.byteCounts, VOLUME_RULE.outlierMultiplier),
    },
  };

  return { maturity: classifyMaturity(activeDays, eventsObserved), eventsObserved, activeDays, activeHours, profile };
}
