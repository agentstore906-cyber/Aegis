/**
 * P2 behavioral-memory parameters (docs/AEGIS_P2_BEHAVIORAL_MEMORY.md
 * "Methodology"). Plain constants on purpose: every threshold a deviation
 * explanation cites is defined here, once, and versioned via
 * METHODOLOGY_VERSION (stored on every baseline) so a past baseline can
 * always be read under the rules that produced it.
 */
export const METHODOLOGY_VERSION = 1;

/** Baselines learn from this many full UTC days ending at the start of today (today never teaches itself). */
export const LEARNING_WINDOW_DAYS = 28;
/** Hourly rollups older than this are pruned (they only feed the window and the history view). */
export const ROLLUP_RETENTION_DAYS = 90;
/** Upper bound on hours rolled up per refresh call — a very long-idle agent catches up over several calls. */
export const MAX_ROLLUP_HOURS_PER_REFRESH = 24 * ROLLUP_RETENTION_DAYS;

/** Events in these states never teach the baseline what "normal" is (they didn't execute as-is). */
export const NON_LEARNABLE_STATUSES = ["BLOCKED", "APPROVAL_REQUIRED"] as const;

/** Cold start — measured over learnable events inside the learning window. */
export const MATURITY_THRESHOLDS = {
  /** Below either: NEW_AGENT (nothing is evaluated). */
  limited: { minActiveDays: 3, minEvents: 50 },
  /** At or above both: ESTABLISHED (every rule is evaluated). In between: LIMITED_HISTORY. */
  established: { minActiveDays: 7, minEvents: 200 },
} as const;

/** A value becomes part of "normal" only once seen this often, on this many distinct days. */
export const ESTABLISHED_KEY = { minCount: 3, minDaysSeen: 2 } as const;
/** A dimension needs this many observations in the window before "new X" means anything. */
export const DIMENSION_MIN_OBSERVATIONS = 20;
/** Above this many distinct values a dimension is high-cardinality: profiled, but no novelty claims. */
export const MAX_KEYS_PER_DIMENSION = 500;

export const FREQUENCY_RULE = {
  /** Unusual when this hour's events exceed max(p95 × multiplier, p95 + margin) of active hours, and at least minCount. */
  p95Multiplier: 3,
  p95Margin: 20,
  minCount: 20,
  /** Active hours needed before hourly statistics are trusted. */
  minActiveHours: 24,
} as const;

export const VOLUME_RULE = {
  /** Unusual when a single event's volume exceeds max(p95 × multiplier, the non-outlier maximum). */
  p95Multiplier: 3,
  minObservations: 20,
  minRecords: 10,
  minBytes: 1_048_576,
  /** Values above outlierMultiplier × p95 are excluded from mean / stddev / max (percentiles are robust anyway). */
  outlierMultiplier: 10,
  /** Most recent per-event volume values read per refresh. */
  sampleLimit: 20_000,
} as const;

/** "Never at this hour" is only claimed for agents active on at least this many days of the window. */
export const TIME_RULE = { minActiveDays: 14 } as const;

/** New end users are only remarkable for agents that serve a small, fixed set. */
export const END_USER_RULE = { maxEstablishedUsers: 10 } as const;

/** Evidence needed for HIGH (vs MEDIUM) confidence on an ESTABLISHED baseline. */
export const HIGH_CONFIDENCE = { minObservations: 200, minActiveDays: 14 } as const;
