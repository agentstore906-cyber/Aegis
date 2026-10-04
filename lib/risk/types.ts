import type { PolicyDecision, RiskLevel, TrustState } from "@prisma/client";

/**
 * Unified risk engine (P4 — docs/AEGIS_P4_RISK_ENGINE.md). Every type here is
 * persisted JSON (PolicyEvaluation.riskAssessment) or feeds it, so changes
 * need a RISK_METHODOLOGY_VERSION bump.
 */

/** How strongly one signal argues for caution. Ordinal on purpose — see compose.ts. */
export type SignalSeverity = "LOW" | "MEDIUM" | "HIGH";

/**
 * Where a signal's evidence comes from. Signals in the same family are
 * correlated (a new destination usually brings a new service), so they never
 * compound each other; only agreement across families does.
 */
export type RiskFamily = "policy" | "request" | "behavior" | "history";

export type RiskSignalCode =
  | "policy_violation"
  | "sensitive_data"
  | "high_risk_action"
  | "new_destination"
  | "unusual_volume"
  | "unusual_sequence"
  | "behavioral_deviation"
  | "trust_degradation"
  | "historical_incident";

/** One concrete thing a reason rests on. `ref` is a row id when one exists. */
export type RiskEvidence = {
  source:
    | "policy"
    | "permission"
    | "request"
    | "behavioral_deviation"
    | "baseline"
    | "trust_state"
    | "policy_evaluation"
    | "approval_request";
  ref?: string;
  detail: Record<string, unknown>;
};

export type RiskSignal = {
  code: RiskSignalCode;
  family: RiskFamily;
  severity: SignalSeverity;
  /** One sentence naming exactly what was observed. */
  summary: string;
  evidence: RiskEvidence[];
};

export type RiskReason = RiskSignal & { rank: number };

/** Something the engine could not know — never silently treated as "safe". */
export type RiskContextNote = {
  code:
    | "baseline_unavailable"
    | "baseline_new_agent"
    | "baseline_limited_history"
    | "trust_unavailable"
    | "trust_stale"
    | "data_classification_not_reported";
  summary: string;
};

/** The ordered outcome of a decision, weakest first. */
export const DECISION_STRICTNESS: Record<PolicyDecision, number> = {
  ALLOW: 0,
  ALERT: 1,
  REQUIRE_APPROVAL: 2,
  BLOCK: 3,
};

export type ShadowOutcome =
  /** The risk engine's own decision equals the actual decision. */
  | "AGREES"
  /** Risk is stricter than what actually happened — the shadow signal. */
  | "WOULD_ESCALATE"
  /** What actually happened was already stricter than risk alone would be. */
  | "ACTUAL_STRICTER"
  /** Risk is stricter, but a consumed human approval held the recommendation at the actual decision. */
  | "SUPPRESSED";

export type ShadowDecision = {
  /** What Aegis actually decided and enforced. */
  actual: PolicyDecision;
  /** What the risk level alone maps to. */
  riskDecision: PolicyDecision;
  /** strictest(actual, riskDecision) unless a human approval suppressed it. Never weaker than actual. */
  recommended: PolicyDecision;
  outcome: ShadowOutcome;
  /** Present when the recommendation was held at `actual` for a stated reason. */
  suppressedBy?: "HUMAN_APPROVAL";
  /** One sentence for humans, e.g. "Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL." */
  summary: string;
};

export type RiskEscalation = {
  applied: boolean;
  /** Distinct families that each contributed a MEDIUM-or-higher signal. */
  corroboratingFamilies: RiskFamily[];
  from: RiskLevel;
  to: RiskLevel;
};

export type RiskContextSummary = {
  baseline: { status: "used" | "unavailable"; version?: number; maturity?: string; computedAt?: string };
  trust: { status: "used" | "unavailable"; state?: TrustState; score?: number; evaluatedAt?: string };
  notes: RiskContextNote[];
};

/** Everything composition produces, before the final decision is known. */
export type RiskAssessmentCore = {
  methodologyVersion: number;
  level: RiskLevel;
  /** E.g. "HIGH RISK — 3 independent kinds of evidence agree". */
  headline: string;
  reasons: RiskReason[];
  escalation: RiskEscalation;
  context: RiskContextSummary;
};

/** The stored record: the core plus the shadow comparison. */
export type RiskAssessment = RiskAssessmentCore & { shadow: ShadowDecision };

// -- Inputs to the pure signal builders --------------------------------------

export type RiskPolicyInput = {
  /** What policy alone resolved to (before kill switch / approval handling). */
  policyDecision: PolicyDecision;
  /** True when a permission or policy matched; false means the default-deny fallback. */
  explicitRuleMatched: boolean;
  winningPolicy?: { id: string; name: string; decision: PolicyDecision; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };
  matchedPermission?: { id: string; action: string; decision: PolicyDecision };
};

export type RiskRequestInput = {
  scoredRule: string | null;
  scoredLevel: RiskLevel;
  dataSensitivity: RiskLevel | null;
  dataClasses: string[];
};

export type RiskDeviationInput = {
  kind: string;
  dedupeKey: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  observed: Record<string, unknown>;
  expected: Record<string, unknown>;
  explanation: string;
};

export type RiskTrustInput = {
  state: TrustState;
  score: number;
  evaluatedAt: Date;
  factors: { code: string; summary: string; points: number }[];
};

export type RiskIncidentInput = {
  type: "policy_evaluation" | "approval_request";
  id: string;
  at: Date;
  /** The decision (policy_evaluation) or "REJECTED" (approval_request). */
  outcome: string;
};

export type RiskInputs = {
  action: string;
  policy: RiskPolicyInput;
  request: RiskRequestInput;
  baseline: { version: number; maturity: "NEW_AGENT" | "LIMITED_HISTORY" | "ESTABLISHED"; computedAt: Date } | null;
  deviations: RiskDeviationInput[];
  trust: RiskTrustInput | null;
  incidents: RiskIncidentInput[];
  /** True when the incident query hit its row limit, so `incidents` is a lower bound. */
  incidentsTruncated: boolean;
  now: Date;
};
