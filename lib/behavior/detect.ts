import type { BehavioralDeviationKind, SecurityAlertConfidence } from "@prisma/client";

import {
  DIMENSION_MIN_OBSERVATIONS,
  END_USER_RULE,
  ESTABLISHED_KEY,
  FREQUENCY_RULE,
  HIGH_CONFIDENCE,
  TIME_RULE,
  VOLUME_RULE,
} from "@/lib/behavior/config";
import type {
  BaselineSnapshot,
  DeviationCandidate,
  DimensionName,
  DimensionProfile,
  EventFeatures,
  VolumeProfile,
} from "@/lib/behavior/types";

/**
 * "This agent is behaving differently from its established baseline."
 *
 * Pure: given a baseline snapshot, one event's features, and how many
 * learnable events this agent has recorded in the event's hour, return the
 * deviations — each with WHAT changed (observed), WHAT was expected
 * (expected), and WHY it's unusual (explanation), using only the thresholds
 * in lib/behavior/config.ts.
 *
 * Cold start: NEW_AGENT → nothing. LIMITED_HISTORY → only "new value"
 * checks, at LOW confidence. ESTABLISHED → every rule. A dimension with too
 * few observations, or too many distinct values, makes no novelty claim.
 */

const NOVELTY: { dimension: DimensionName; kind: BehavioralDeviationKind; noun: string; field: (f: EventFeatures) => string[] }[] = [
  { dimension: "tool", kind: "NEW_TOOL", noun: "tool", field: (f) => (f.toolKey ? [f.toolKey] : []) },
  { dimension: "destination", kind: "NEW_DESTINATION", noun: "destination", field: (f) => (f.destination ? [f.destination] : []) },
  { dimension: "service", kind: "NEW_SERVICE", noun: "service", field: (f) => (f.service ? [f.service] : []) },
  { dimension: "eventType", kind: "NEW_ACTION_TYPE", noun: "action type", field: (f) => [f.eventType] },
  { dimension: "dataClass", kind: "UNUSUAL_DATA_TYPE", noun: "data type", field: (f) => f.dataClasses },
  { dimension: "transition", kind: "UNUSUAL_SEQUENCE", noun: "action sequence", field: (f) => (f.transition ? [f.transition] : []) },
  { dimension: "endUser", kind: "NEW_END_USER", noun: "end user", field: (f) => (f.endUserHash ? [f.endUserHash] : []) },
];

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const pct = (share: number) => `${Math.round(share * 100)}%`;

function confidenceFor(baseline: BaselineSnapshot, observations: number): SecurityAlertConfidence {
  if (baseline.maturity !== "ESTABLISHED") return "LOW";
  return observations >= HIGH_CONFIDENCE.minObservations && baseline.profile.activeDays >= HIGH_CONFIDENCE.minActiveDays
    ? "HIGH"
    : "MEDIUM";
}

function describeEstablished(dim: DimensionProfile, limit = 5) {
  return dim.established.slice(0, limit).map((e) => ({ key: e.key, share: e.share, count: e.count, daysSeen: e.daysSeen }));
}

function noveltyDeviations(baseline: BaselineSnapshot, features: EventFeatures): DeviationCandidate[] {
  const out: DeviationCandidate[] = [];
  const windowDays = baseline.profile.windowDays;

  for (const rule of NOVELTY) {
    const dim = baseline.profile.dimensions[rule.dimension];
    if (!dim || dim.highCardinality || dim.observations < DIMENSION_MIN_OBSERVATIONS) continue;
    if (rule.dimension === "endUser" && dim.established.length > END_USER_RULE.maxEstablishedUsers) continue;

    for (const value of rule.field(features)) {
      if (dim.established.some((e) => e.key === value)) continue;
      const provisional = dim.provisional.find((e) => e.key === value);
      const shown = rule.dimension === "endUser" ? "a new end user (pseudonymized)" : `"${value}"`;
      const usual = dim.established
        .slice(0, 3)
        .map((e) => (rule.dimension === "endUser" ? pct(e.share) : `${e.key} (${pct(e.share)})`))
        .join(", ");

      const history = provisional
        ? `${shown} appeared only ${fmt(provisional.count)} time(s) on ${provisional.daysSeen} day(s) in the last ${windowDays} days — not enough to count as normal (needs ${ESTABLISHED_KEY.minCount}+ times on ${ESTABLISHED_KEY.minDaysSeen}+ days).`
        : `${shown} was never seen in the last ${windowDays} days.`;

      out.push({
        kind: rule.kind,
        dedupeKey: `${rule.dimension}:${value}`,
        confidence: confidenceFor(baseline, dim.observations),
        observed: { dimension: rule.dimension, value, previouslySeen: provisional ? { count: provisional.count, daysSeen: provisional.daysSeen } : null },
        expected: {
          dimension: rule.dimension,
          established: describeEstablished(dim),
          establishedCount: dim.established.length,
          observations: dim.observations,
          windowDays,
        },
        explanation:
          `New ${rule.noun}: this agent used ${shown}. ${history} ` +
          `Expected: one of its ${fmt(dim.established.length)} established ${rule.noun}${dim.established.length === 1 ? "" : "s"}` +
          `${usual ? ` (most common: ${usual})` : ""}, from ${fmt(dim.observations)} observations.`,
      });
    }
  }
  return out;
}

function volumeDeviation(
  baseline: BaselineSnapshot,
  value: number | null,
  stats: VolumeProfile | null,
  unit: "records" | "bytes"
): DeviationCandidate | null {
  if (value === null || !stats || stats.n < VOLUME_RULE.minObservations) return null;
  const minimum = unit === "records" ? VOLUME_RULE.minRecords : VOLUME_RULE.minBytes;
  const threshold = Math.max(stats.p95 * VOLUME_RULE.p95Multiplier, stats.max);
  if (value < minimum || value <= threshold) return null;

  return {
    kind: "UNUSUAL_VOLUME",
    dedupeKey: `volume:${unit}`,
    confidence: confidenceFor(baseline, stats.n),
    observed: { unit, value, ratioToP95: stats.p95 > 0 ? Math.round((value / stats.p95) * 10) / 10 : null },
    expected: { unit, median: stats.median, p95: stats.p95, max: stats.max, n: stats.n, threshold, windowDays: baseline.profile.windowDays },
    explanation:
      `Unusual volume: one event involved ${fmt(value)} ${unit}. ` +
      `Over the last ${baseline.profile.windowDays} days this agent's events had a median of ${fmt(stats.median)} and a 95th percentile of ${fmt(stats.p95)} ${unit} (largest: ${fmt(stats.max)}, n=${fmt(stats.n)}); ` +
      `anything above ${fmt(threshold)} (the larger of 3× the 95th percentile and the largest normal value) is flagged.`,
  };
}

function frequencyDeviation(baseline: BaselineSnapshot, features: EventFeatures, currentHourCount: number): DeviationCandidate | null {
  const stats = baseline.profile.frequency.activeHour;
  if (!stats || stats.n < FREQUENCY_RULE.minActiveHours) return null;
  const threshold = Math.max(stats.p95 * FREQUENCY_RULE.p95Multiplier, stats.p95 + FREQUENCY_RULE.p95Margin);
  if (currentHourCount < FREQUENCY_RULE.minCount || currentHourCount <= threshold) return null;

  const hour = new Date(features.timestamp);
  hour.setUTCMinutes(0, 0, 0);
  return {
    kind: "UNUSUAL_FREQUENCY",
    dedupeKey: `hour:${hour.toISOString()}`,
    confidence: confidenceFor(baseline, stats.n),
    observed: { hourStart: hour.toISOString(), events: currentHourCount },
    expected: { median: stats.median, p95: stats.p95, max: stats.max, activeHours: stats.n, threshold, windowDays: baseline.profile.windowDays },
    explanation:
      `Unusual frequency: ${fmt(currentHourCount)} events in the hour starting ${hour.toISOString().slice(11, 16)} UTC. ` +
      `In its ${fmt(stats.n)} active hours over the last ${baseline.profile.windowDays} days this agent had a median of ${fmt(stats.median)} and a 95th percentile of ${fmt(stats.p95)} events per hour (busiest: ${fmt(stats.max)}); ` +
      `more than ${fmt(threshold)} is flagged.`,
  };
}

function timeDeviation(baseline: BaselineSnapshot, features: EventFeatures): DeviationCandidate | null {
  if (baseline.profile.activeDays < TIME_RULE.minActiveDays) return null;
  const hour = features.timestamp.getUTCHours();
  if (baseline.profile.hourOfDay[hour] > 0) return null;
  const usualHours = baseline.profile.hourOfDay
    .map((count, h) => ({ h, count }))
    .filter((x) => x.count > 0)
    .map((x) => x.h);
  const label = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return {
    kind: "UNUSUAL_TIME",
    dedupeKey: `hourOfDay:${hour}`,
    confidence: confidenceFor(baseline, baseline.profile.eventsObserved),
    observed: { hourOfDayUtc: hour },
    expected: { activeHoursOfDayUtc: usualHours, activeDays: baseline.profile.activeDays, windowDays: baseline.profile.windowDays },
    explanation:
      `Unusual time: activity between ${label(hour)} and ${label((hour + 1) % 24)} UTC. ` +
      `This agent was active on ${baseline.profile.activeDays} of the last ${baseline.profile.windowDays} days and never in that hour; ` +
      `its activity has fallen within ${usualHours.length} of 24 hours of the day.`,
  };
}

export function detectDeviations(
  baseline: BaselineSnapshot | null,
  features: EventFeatures,
  currentHourCount: number
): DeviationCandidate[] {
  if (!baseline || baseline.maturity === "NEW_AGENT") return [];

  const out = noveltyDeviations(baseline, features);
  if (baseline.maturity !== "ESTABLISHED") return out;

  for (const candidate of [
    volumeDeviation(baseline, features.recordCount, baseline.profile.volume.records, "records"),
    volumeDeviation(baseline, features.byteCount, baseline.profile.volume.bytes, "bytes"),
    frequencyDeviation(baseline, features, currentHourCount),
    timeDeviation(baseline, features),
  ]) {
    if (candidate) out.push(candidate);
  }
  return out;
}
