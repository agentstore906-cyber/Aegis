import type { SecurityAlertConfidence, SecurityAlertSeverity, SecurityAlertStatus } from "@prisma/client";

export class SecurityAlertNotFoundError extends Error {
  constructor() {
    super("Security alert not found.");
    this.name = "SecurityAlertNotFoundError";
  }
}

export class SecurityAlertAlreadyResolvedError extends Error {
  constructor(public readonly currentStatus: SecurityAlertStatus) {
    super(`This alert is already ${currentStatus.toLowerCase()}.`);
    this.name = "SecurityAlertAlreadyResolvedError";
  }
}

/**
 * Flat const map, not a Prisma enum — like AUDIT_EVENT_TYPES — so a new
 * detector never requires a migration. A cost anomaly (COST_SPIKE) is
 * deliberately just another entry here, not a separate alert system —
 * see docs/cost-intelligence.md.
 */
export const SECURITY_ALERT_TYPES = {
  NEW_SENSITIVE_ACTION: "NEW_SENSITIVE_ACTION",
  BLOCK_SPIKE: "BLOCK_SPIKE",
  FAILURE_LOOP: "FAILURE_LOOP",
  NEW_TOOL_USAGE: "NEW_TOOL_USAGE",
  HIGH_RISK_BURST: "HIGH_RISK_BURST",
  COST_SPIKE: "COST_SPIKE",
  ACTIVITY_VOLUME_SPIKE: "ACTIVITY_VOLUME_SPIKE",
  // Phase 2 (Behavioral Intelligence) — same baseline-relative shape as
  // COST_SPIKE/ACTIVITY_VOLUME_SPIKE: today's count vs. this agent's own
  // trailing 7-day daily average, never a fleet-wide or absolute threshold.
  DATA_ACCESS_SPIKE: "DATA_ACCESS_SPIKE",
  DELETE_ACTIVITY_SPIKE: "DELETE_ACTIVITY_SPIKE",
  COMMUNICATION_SPIKE: "COMMUNICATION_SPIKE",
  // Not a behavioral detector — raised directly by the policy engine
  // (lib/policies/evaluate.ts) when an ALERT-decision policy matches an
  // action. A human-configured rule, not an inferred deviation.
  POLICY_ALERT: "POLICY_ALERT",
  // P5: raised when an organization's risk control (not a configured policy)
  // turns a request into an ALERT. Operator-facing evidence; never counted
  // toward agent trust (it would feed back into risk).
  RISK_ALERT: "RISK_ALERT",
  // Firewall truthfulness (spec §8): raised when a *self-reported*,
  // already-completed action (POST /api/v1/events) would have resolved to
  // BLOCK had it gone through the pre-flight /evaluate path first. Always
  // "detected", never "blocked" — the action already happened and Aegis
  // had no chance to prevent it. See lib/security/evaluate.ts.
  POLICY_VIOLATION_DETECTED: "POLICY_VIOLATION_DETECTED",
  // Kill-switch truthfulness (P0): a STOPPED/PAUSED/ARCHIVED agent reported
  // an action it completed anyway. Aegis refuses such an agent's /evaluate
  // calls, but can't physically stop it — this is the evidence that the
  // halt wasn't honored. Always "detected", never "blocked".
  ACTIVITY_WHILE_HALTED: "ACTIVITY_WHILE_HALTED",
  // AI Agent Security (Phase 9) — heuristic indicators, always carry a
  // `confidence`, never asserted as certain.
  PROMPT_INJECTION_INDICATOR: "PROMPT_INJECTION_INDICATOR",
  CREDENTIAL_EXPOSURE_DETECTED: "CREDENTIAL_EXPOSURE_DETECTED",
  // Cost Intelligence (Phase 6) — monitoring only, never a claim that
  // spending was actually blocked. See lib/costs/budgets.ts.
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  BUDGET_WARNING: "BUDGET_WARNING",
} as const;

export type SecurityAlertType = (typeof SECURITY_ALERT_TYPES)[keyof typeof SECURITY_ALERT_TYPES];

/**
 * A detector's raw output before persistence. Deliberately explainable —
 * every field answers one of spec's "what happened / why is this unusual
 * / what evidence triggered it" questions. `evidence` is redacted (see
 * redact.ts) before it's ever written to the database.
 */
export type Finding = {
  type: SecurityAlertType;
  severity: SecurityAlertSeverity;
  agentId: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  traceId?: string | null;
  /** How sure the detector is this is real, distinct from severity. Unset = deterministic (not a probabilistic indicator). */
  confidence?: SecurityAlertConfidence;
  /** A concrete next step for a reviewer — e.g. "Review this policy" or "Rotate the exposed credential." */
  recommendedAction?: string;
  /**
   * What makes this finding a *different* alert from another of the same
   * type for the same agent (e.g. the action, tool, or policy involved).
   * Omitted = one alert per (agent, type) — right for agent-wide spikes.
   * See lib/security/repository.ts#upsertAlertFinding.
   */
  dedupeKey?: string;
};

/**
 * Severity rules (spec §36) — written down, not implicit in scattered
 * conditionals:
 *
 *   NEW_SENSITIVE_ACTION  HIGH  (first-ever use of a HIGH/CRITICAL-risk action)
 *                         CRITICAL if the attempt was itself BLOCKED
 *                         (e.g. a first-ever bank_account.change attempt)
 *   BLOCK_SPIKE           HIGH  (more than the threshold of blocked actions in the window)
 *   FAILURE_LOOP          MEDIUM (same action failing repeatedly)
 *   NEW_TOOL_USAGE        LOW   (agent used an action namespace it hasn't before)
 *   HIGH_RISK_BURST       HIGH  (several HIGH/CRITICAL-risk actions in a short window)
 *   COST_SPIKE            HIGH  (today's spend is a large multiple of the trailing baseline)
 *   ACTIVITY_VOLUME_SPIKE HIGH (this hour's action count is a large multiple of the trailing hourly baseline)
 *   DATA_ACCESS_SPIKE     HIGH  (today's DATA_ACCESS count is a large multiple of this agent's trailing daily average)
 *   DELETE_ACTIVITY_SPIKE HIGH  (today's delete-shaped action count is a large multiple of this agent's trailing daily average)
 *   COMMUNICATION_SPIKE   MEDIUM (today's COMMUNICATION count is a large multiple of this agent's trailing daily average)
 *
 * lib/security/detectors.ts implements each rule exactly as described
 * here — there is no separate scoring model to keep in sync.
 */
