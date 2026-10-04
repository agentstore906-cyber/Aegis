/** P2 — statistics, profile building, cold start. Pure functions. */
import { describe, expect, it } from "vitest";

import { percentile, robustSummarize, summarize } from "@/lib/behavior/stats";
import { buildProfile, classifyMaturity, type CategoricalRow } from "@/lib/behavior/profile";
import { MAX_KEYS_PER_DIMENSION } from "@/lib/behavior/config";

describe("stats", () => {
  it("percentile uses linear interpolation between closest ranks (type 7)", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5.5);
    expect(percentile(sorted, 0.95)).toBeCloseTo(9.55);
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("summarize reports n, mean, sample stddev, min, median, p90/p95/p99, max", () => {
    expect(summarize([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
      n: 8,
      mean: 5,
      stddev: 2.14,
      min: 2,
      median: 4.5,
      p90: 7.6,
      p95: 8.3,
      p99: 8.86,
      max: 9,
    });
    expect(summarize([])).toBeNull();
  });

  it("robustSummarize keeps one extreme value from defining max/mean, and reports it", () => {
    const normal = Array.from({ length: 99 }, () => 10);
    const robust = robustSummarize([...normal, 1_000_000], 10)!;
    expect(robust.max).toBe(10);
    expect(robust.mean).toBe(10);
    expect(robust.excludedOutliers).toBe(1);
    expect(summarize([...normal, 1_000_000])!.max).toBe(1_000_000);
  });
});

describe("classifyMaturity — cold start", () => {
  it("NEW_AGENT below 3 active days or 50 events", () => {
    expect(classifyMaturity(0, 0)).toBe("NEW_AGENT");
    expect(classifyMaturity(2, 5_000)).toBe("NEW_AGENT");
    expect(classifyMaturity(10, 49)).toBe("NEW_AGENT");
  });
  it("LIMITED_HISTORY until 7 active days and 200 events", () => {
    expect(classifyMaturity(3, 50)).toBe("LIMITED_HISTORY");
    expect(classifyMaturity(6, 1_000)).toBe("LIMITED_HISTORY");
    expect(classifyMaturity(20, 199)).toBe("LIMITED_HISTORY");
  });
  it("ESTABLISHED at 7+ active days and 200+ events", () => {
    expect(classifyMaturity(7, 200)).toBe("ESTABLISHED");
  });
});

const windowEnd = new Date("2026-10-03T00:00:00.000Z");
const windowStart = new Date("2026-09-05T00:00:00.000Z");
const at = (iso: string) => new Date(iso);
const row = (dimension: string, key: string, count: number, daysSeen: number): CategoricalRow => ({
  dimension,
  key,
  count,
  daysSeen,
  firstSeen: at("2026-09-10T09:00:00Z"),
  lastSeen: at("2026-10-02T09:00:00Z"),
});

describe("buildProfile", () => {
  it("separates established values (3+ times on 2+ days) from provisional ones", () => {
    const { profile } = buildProfile({
      windowStart,
      windowEnd,
      categorical: [row("tool", "crm", 100, 20), row("tool", "burst-tool", 50, 1), row("tool", "rare", 2, 2)],
      hourlyTotals: [],
      excludedHours: new Set(),
      recordCounts: [],
      byteCounts: [],
    });
    expect(profile.dimensions.tool.established.map((e) => e.key)).toEqual(["crm"]);
    expect(profile.dimensions.tool.provisional.map((e) => e.key)).toEqual(["burst-tool", "rare"]);
    expect(profile.dimensions.tool.observations).toBe(152);
    expect(profile.dimensions.tool.established[0].share).toBeCloseTo(100 / 152, 3);
    expect(profile.dimensions.destination).toMatchObject({ observations: 0, established: [], highCardinality: false });
  });

  it("marks a dimension with too many distinct values as high-cardinality (no novelty claims) and caps stored keys", () => {
    const many = Array.from({ length: MAX_KEYS_PER_DIMENSION + 5 }, (_, i) => row("endUser", `u${i}`, 3, 2));
    const { profile } = buildProfile({
      windowStart,
      windowEnd,
      categorical: many,
      hourlyTotals: [],
      excludedHours: new Set(),
      recordCounts: [],
      byteCounts: [],
    });
    expect(profile.dimensions.endUser.highCardinality).toBe(true);
    expect(profile.dimensions.endUser.distinct).toBe(MAX_KEYS_PER_DIMENSION + 5);
    expect(profile.dimensions.endUser.established.length + profile.dimensions.endUser.provisional.length).toBe(MAX_KEYS_PER_DIMENSION);
  });

  it("computes frequency and time-of-day from active hours, excluding hours already flagged as anomalies", () => {
    const hourlyTotals = [
      { hourStart: at("2026-10-01T09:00:00.000Z"), count: 4 },
      { hourStart: at("2026-10-01T10:00:00.000Z"), count: 6 },
      { hourStart: at("2026-10-02T09:00:00.000Z"), count: 5 },
      { hourStart: at("2026-10-02T03:00:00.000Z"), count: 900 }, // flagged burst
    ];
    const built = buildProfile({
      windowStart,
      windowEnd,
      categorical: [],
      hourlyTotals,
      excludedHours: new Set(["2026-10-02T03:00:00.000Z"]),
      recordCounts: [],
      byteCounts: [],
    });
    expect(built.eventsObserved).toBe(915);
    expect(built.activeDays).toBe(2);
    expect(built.activeHours).toBe(4);
    expect(built.profile.frequency.activeHour).toMatchObject({ n: 3, median: 5, max: 6 });
    expect(built.profile.frequency.excludedOutlierHours).toBe(1);
    expect(built.profile.hourOfDay[9]).toBe(9);
    expect(built.profile.hourOfDay[3]).toBe(0);
    expect(built.profile.frequency.activeDay).toMatchObject({ n: 2, min: 5, max: 10 });
  });

  it("is honest about an agent with no history", () => {
    const built = buildProfile({ windowStart, windowEnd, categorical: [], hourlyTotals: [], excludedHours: new Set(), recordCounts: [], byteCounts: [] });
    expect(built.maturity).toBe("NEW_AGENT");
    expect(built.profile.frequency.activeHour).toBeNull();
    expect(built.profile.volume.records).toBeNull();
    expect(built.profile.firstActivityAt).toBeNull();
  });
});
