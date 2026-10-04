import type { SecurityAlertConfidence, SecurityAlertSeverity, TrustState } from "@prisma/client";

/**
 * P3 agent-trust parameters (docs/AEGIS_P3_AGENT_TRUST.md). Plain constants
 * on purpose: every number a trust explanation cites is defined here, once,
 * and versioned via TRUST_METHODOLOGY_VERSION (stored on every transition)
 * so a past change can always be read under the rules that produced it.
 *
 * Model: score = 100 − Σ penalties, each penalty being one piece of evidence
 * weighted by its severity and by how recent it is (linear decay to zero over
 * its window). Because every penalty decays, trust recovers by itself when
 * behavior returns to normal — nothing is permanent.
 */
export const TRUST_METHODOLOGY_VERSION = 1;

/** Best state first. A state is entered at score >= min (plus the recovery margin when moving UP). */
export const TRUST_STATE_ORDER: readonly TrustState[] = ["TRUSTED", "NORMAL", "DEGRADED", "HIGH_RISK", "RESTRICTED"] as const;

export const TRUST_THRESHOLDS: Record<TrustState, { min: number }> = {
  TRUSTED: { min: 85 },
  NORMAL: { min: 60 },
  DEGRADED: { min: 40 },
  HIGH_RISK: { min: 20 },
  RESTRICTED: { min: 0 },
};

/**
 * Hysteresis: moving to a BETTER state needs score >= threshold + margin, so
 * a score hovering at a boundary can't flap. Moving to a worse state has no
 * margin — degradation is never delayed.
 */
export const TRUST_RECOVERY_MARGIN = 5;

/** A score move inside the same state is recorded as a transition only when it reaches this many points. */
export const TRUST_MIN_SCORE_DELTA = 5;

/**
 * Until an agent has this many days of history AND an ESTABLISHED behavioral
 * baseline (P2), trust is capped below TRUSTED: absence of bad evidence isn't
 * evidence of good behavior.
 */
export const TRUST_HISTORY_REQUIREMENT = { minAgeDays: 14, ceilingScore: TRUST_THRESHOLDS.TRUSTED.min - 1 } as const;

/** A GET re-evaluates when the stored evaluation is older than this (so decay/recovery show without new activity). */
export const TRUST_MAX_STALENESS_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrustCategoryName = "behavior" | "blocked" | "violations" | "alerts" | "approvals";

/** Evidence window and the most the category can subtract from the score. */
export const TRUST_CATEGORIES: Record<TrustCategoryName, { label: string; windowMs: number; cap: number }> = {
  behavior: { label: "Behavioral deviations", windowMs: 7 * DAY_MS, cap: 40 },
  blocked: { label: "Blocked actions", windowMs: 7 * DAY_MS, cap: 30 },
  violations: { label: "Policy violations", windowMs: 7 * DAY_MS, cap: 20 },
  alerts: { label: "Security alerts", windowMs: 30 * DAY_MS, cap: 45 },
  approvals: { label: "Rejected approvals", windowMs: 14 * DAY_MS, cap: 12 },
};

/** Points per P2 deviation at full strength (before confidence, repeats, and decay). */
export const DEVIATION_POINTS = {
  NEW_DESTINATION: 10,
  UNUSUAL_DATA_TYPE: 10,
  UNUSUAL_VOLUME: 10,
  UNUSUAL_SEQUENCE: 6,
  NEW_TOOL: 6,
  UNUSUAL_FREQUENCY: 6,
  NEW_SERVICE: 5,
  NEW_ACTION_TYPE: 4,
  UNUSUAL_TIME: 3,
  NEW_END_USER: 2,
} as const;

/** A LIMITED_HISTORY baseline only claims LOW confidence, so its deviations weigh less. */
export const CONFIDENCE_MULTIPLIER: Record<SecurityAlertConfidence, number> = { LOW: 0.4, MEDIUM: 0.75, HIGH: 1 };

/** Each repeat of the same deviation on the same day adds this much, up to the max multiplier (repeated incidents weigh more). */
export const DEVIATION_REPEAT = { perRepeat: 0.1, maxMultiplier: 1.5 } as const;

/** Policy decisions (PolicyEvaluation rows). Kill-switch refusals (decisionSource CONTROL) are operator actions, not agent behavior, and are excluded. */
export const BLOCK_POINTS = { policyBlock: 6, defaultDeny: 4 } as const;
export const VIOLATION_POINTS = 5;

/**
 * Security alert types that carry independent evidence. Excluded types would
 * double-count something already scored elsewhere (policy ALERT/BLOCK
 * decisions, P2 deviations) or aren't about agent behavior (cost, budgets).
 */
export const TRUST_ALERT_TYPES: readonly string[] = [
  "NEW_SENSITIVE_ACTION",
  "FAILURE_LOOP",
  "HIGH_RISK_BURST",
  "DATA_ACCESS_SPIKE",
  "DELETE_ACTIVITY_SPIKE",
  "COMMUNICATION_SPIKE",
  "POLICY_VIOLATION_DETECTED",
  "ACTIVITY_WHILE_HALTED",
  "PROMPT_INJECTION_INDICATOR",
  "CREDENTIAL_EXPOSURE_DETECTED",
];

export const ALERT_SEVERITY_POINTS: Record<SecurityAlertSeverity, number> = { LOW: 3, MEDIUM: 8, HIGH: 15, CRITICAL: 25 };
/** A human who resolved the alert has dealt with it: it still counts as history, at reduced weight. */
export const ALERT_STATUS_MULTIPLIER = { OPEN: 1, ACKNOWLEDGED: 0.75, RESOLVED: 0.25 } as const;

export const REJECTED_APPROVAL_POINTS = 4;

/** Upper bounds on rows read per source (a retry-loop agent can't make evaluation unbounded). */
export const TRUST_EVIDENCE_LIMITS = { deviations: 200, evaluations: 200, alerts: 100, approvals: 100 } as const;

/** Most factors stored in a snapshot; category totals still include every one. */
export const TRUST_MAX_FACTORS = 25;
