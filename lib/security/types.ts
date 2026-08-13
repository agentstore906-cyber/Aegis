import type { SecurityAlertSeverity, SecurityAlertStatus } from "@prisma/client";

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
 *
 * lib/security/detectors.ts implements each rule exactly as described
 * here — there is no separate scoring model to keep in sync.
 */
