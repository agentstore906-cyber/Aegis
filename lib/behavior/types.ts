import type { BaselineMaturity, BehavioralDeviationKind, SecurityAlertConfidence } from "@prisma/client";

/** Every dimension Aegis profiles — each backed by a reliably-populated field (see the P2 doc). */
export const DIMENSIONS = [
  "action",
  "eventType",
  "tool",
  "service",
  "destination",
  "dataClass",
  "environment",
  "endUser",
  "outcome",
  "decision",
  "transition",
] as const;
export type DimensionName = (typeof DIMENSIONS)[number];

export type Summary = {
  n: number;
  mean: number;
  stddev: number;
  min: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
};

export type DimensionEntry = {
  key: string;
  count: number;
  /** Share of this dimension's observations, 0..1. */
  share: number;
  daysSeen: number;
  firstSeen: string;
  lastSeen: string;
};

export type DimensionProfile = {
  observations: number;
  distinct: number;
  /** Too many distinct values to keep: profiled for display, but no "new value" claims. */
  highCardinality: boolean;
  /** Seen ≥ ESTABLISHED_KEY.minCount times on ≥ minDaysSeen days — part of "normal". */
  established: DimensionEntry[];
  /** Seen in the window, but not (yet) often enough to count as normal. */
  provisional: DimensionEntry[];
};

export type VolumeProfile = Summary & { excludedOutliers: number };

/** The JSON stored in AgentBaseline.profile (methodologyVersion 1). */
export type BehaviorProfile = {
  methodologyVersion: number;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  eventsObserved: number;
  activeDays: number;
  activeHours: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  dimensions: Record<DimensionName, DimensionProfile>;
  frequency: {
    /** Events per hour, over hours that had any activity (outlier-flagged hours excluded). */
    activeHour: Summary | null;
    /** Events per active day. */
    activeDay: Summary | null;
    /** Share of hours (from first activity to window end) with any activity. */
    activeHourShare: number;
    /** Hours previously flagged UNUSUAL_FREQUENCY and excluded from the statistics. */
    excludedOutlierHours: number;
  };
  /** Events per UTC hour of day (0..23), outlier hours excluded. */
  hourOfDay: number[];
  volume: { records: VolumeProfile | null; bytes: VolumeProfile | null };
};

export type BaselineSnapshot = {
  version: number;
  maturity: BaselineMaturity;
  profile: BehaviorProfile;
};

/** What the detector needs to know about one event. */
export type EventFeatures = {
  eventId: string;
  timestamp: Date;
  eventType: string;
  toolKey: string | null;
  service: string | null;
  destination: string | null;
  dataClasses: string[];
  endUserHash: string | null;
  recordCount: number | null;
  byteCount: number | null;
  /** "parentAction>action" when the event has a parent. */
  transition: string | null;
};

export type DeviationCandidate = {
  kind: BehavioralDeviationKind;
  dedupeKey: string;
  confidence: SecurityAlertConfidence;
  /** WHAT changed. */
  observed: Record<string, unknown>;
  /** WHAT historical behavior was expected. */
  expected: Record<string, unknown>;
  /** One readable paragraph: what changed, why it's unusual, what was expected. */
  explanation: string;
};
