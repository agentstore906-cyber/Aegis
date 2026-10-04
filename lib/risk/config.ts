import type { PolicyDecision, RiskLevel, TrustState } from "@prisma/client";

import type { SignalSeverity } from "@/lib/risk/types";

/**
 * Every rule the P4 risk engine applies, in one place, with the reason for
 * each choice. There are deliberately NO numeric weights: severities are an
 * ordinal scale (LOW < MEDIUM < HIGH) because nothing in Aegis's telemetry
 * supports claiming that one signal is "2.3× as risky" as another. Ordinal
 * rules can be stated in a sentence, tested exhaustively, and explained to
 * the person reading an approval — a weighted sum cannot.
 *
 * Changing anything here changes what an assessment means: bump
 * RISK_METHODOLOGY_VERSION (it is stored on every assessment).
 */
export const RISK_METHODOLOGY_VERSION = 1;

export const LEVEL_ORDER: readonly RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const SEVERITY_ORDER: readonly SignalSeverity[] = ["LOW", "MEDIUM", "HIGH"] as const;

/**
 * Risk level → the decision it argues for. BLOCK is intentionally not
 * reachable from risk alone: blocking is reserved for explicit policy and the
 * kill switch until shadow data shows the engine's precision. CRITICAL
 * therefore maps to the same decision as HIGH — the level still records the
 * difference.
 */
export const LEVEL_TO_DECISION: Record<RiskLevel, PolicyDecision> = {
  LOW: "ALLOW",
  MEDIUM: "ALERT",
  HIGH: "REQUIRE_APPROVAL",
  CRITICAL: "REQUIRE_APPROVAL",
};

/**
 * Corroboration: when this many independent families each contribute a
 * MEDIUM-or-higher signal, the level rises one step (once).
 * Two, because that is the smallest number that is "independent evidence
 * agreeing" rather than one source repeating itself; more than one step
 * would let weak, correlated-in-practice evidence reach CRITICAL.
 */
export const CORROBORATION_MIN_FAMILIES = 2;

/**
 * Behavioral deviation kinds → how much they matter at HIGH confidence.
 * MEDIUM: the deviation changes WHERE data can go, WHAT can be touched or HOW
 * MUCH leaves — the shapes exfiltration and misuse take. LOW: the deviation is
 * an indicator, not a capability (a new end user or an odd hour is common in
 * legitimate use). A deviation's severity is then capped by its own detector
 * confidence (see CONFIDENCE_CEILING), so a young baseline can never escalate.
 */
export const DEVIATION_SEVERITY: Record<string, SignalSeverity> = {
  NEW_DESTINATION: "MEDIUM",
  UNUSUAL_VOLUME: "MEDIUM",
  UNUSUAL_SEQUENCE: "MEDIUM",
  NEW_TOOL: "MEDIUM",
  UNUSUAL_DATA_TYPE: "MEDIUM",
  NEW_SERVICE: "LOW",
  NEW_ACTION_TYPE: "LOW",
  NEW_END_USER: "LOW",
  UNUSUAL_FREQUENCY: "LOW",
  UNUSUAL_TIME: "LOW",
};

/** Deviation detector confidence → the most severe a signal built on it may be. */
export const CONFIDENCE_CEILING: Record<"LOW" | "MEDIUM" | "HIGH", SignalSeverity> = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

/** Data sensitivity (P1 classes) → severity. Handling HIGH data is routine for many agents; CRITICAL (health, credentials) is not. */
export const SENSITIVITY_SEVERITY: Partial<Record<RiskLevel, SignalSeverity>> = {
  HIGH: "MEDIUM",
  CRITICAL: "HIGH",
};

/**
 * Keyword-rule level (lib/security/risk-scoring.ts) → severity. The weakest
 * evidence Aegis has: it matches words in an action name the agent chose, so
 * it can only nudge. Only the two top levels produce a signal at all.
 */
export const ACTION_RULE_SEVERITY: Partial<Record<RiskLevel, SignalSeverity>> = {
  HIGH: "LOW",
  CRITICAL: "MEDIUM",
};

/** Trust state (P3) → severity. TRUSTED and NORMAL produce no signal. */
export const TRUST_SEVERITY: Partial<Record<TrustState, SignalSeverity>> = {
  DEGRADED: "MEDIUM",
  HIGH_RISK: "HIGH",
  RESTRICTED: "HIGH",
};

/** A stored trust evaluation older than this is flagged as stale context (it is still used). */
export const TRUST_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Prior incidents for the same agent AND same action. Window = the longest
 * trust-category window for these evidence kinds (rejected approvals, 14
 * days): a repeat inside two weeks reads as a pattern.
 * One prior incident is LOW (it may have been a one-off); repeated incidents
 * are MEDIUM. Lookup is bounded.
 */
export const INCIDENT_WINDOW_DAYS = 14;
export const INCIDENT_REPEAT_MIN = 2;
export const INCIDENT_QUERY_LIMIT = 10;

/** Evidence entries kept per reason, so stored assessments stay small. */
export const MAX_EVIDENCE_PER_REASON = 5;

/**
 * The assessment must never delay or fail a decision: context loading gets
 * this long, then the evaluation proceeds without a risk assessment.
 */
export const RISK_CONTEXT_TIMEOUT_MS = 1500;
