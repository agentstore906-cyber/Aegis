import type { ActivityStatus, AgentStatus, ApprovalStatus, PolicyDecision, RiskLevel, TrustState } from "@prisma/client";

/**
 * The words the product is allowed to use for what happened — one place, so
 * "blocked", "recorded" and "awaiting approval" cannot drift between pages.
 *
 * The rule this module exists to enforce (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §4):
 * Aegis is a decision service and an audit trail. It is NOT in the agent's data
 * path. So
 *   BLOCKED            = Aegis denied the request (it returned BLOCK). Never "the action was prevented".
 *   AWAITING APPROVAL  = Aegis returned REQUIRE_APPROVAL and a human decision is pending.
 *   ALLOWED            = Aegis returned ALLOW (or ALERT: allowed and flagged).
 *   RECORDED           = an agent REPORTED something and Aegis stored it. Aegis decided nothing.
 * Nothing here ever says "enforced", "prevented", "stopped the action" or "protected":
 * those claims need evidence the data model does not have for an individual event.
 *
 * Pure (no React) so every mapping is unit-tested, including that the forbidden
 * words never appear.
 */

/** The state colors. Color carries STATE only (see the console theme in app/globals.css). */
export type StateTone = "safe" | "warning" | "risk" | "blocked" | "approval" | "system" | "neutral";

export type Presentation = {
  /** Short, upper-case-able label for a badge. */
  label: string;
  tone: StateTone;
  /** One sentence for decision/detail views: what this does and does not mean. */
  meaning: string;
};

export const DECISION: Record<PolicyDecision, Presentation> = {
  ALLOW: { label: "Allowed", tone: "safe", meaning: "Aegis returned ALLOW and recorded the decision." },
  ALERT: { label: "Allowed · flagged", tone: "warning", meaning: "Aegis returned ALERT: the action may proceed and was flagged. The decision and an alert are recorded." },
  REQUIRE_APPROVAL: {
    label: "Awaiting approval",
    tone: "approval",
    meaning: "Aegis returned REQUIRE_APPROVAL and opened an approval request. The integration should not proceed until a human decides.",
  },
  BLOCK: {
    label: "Blocked",
    tone: "blocked",
    meaning: "Aegis returned BLOCK and recorded the denial. Aegis returns decisions; whether the action actually stopped depends on the integration honoring it.",
  },
};

/**
 * What an activity row's status means depends on WHO produced the row:
 *   source "policy_evaluation"  Aegis made a decision → the decision vocabulary applies
 *   source "api"                the AGENT reported it → Aegis only recorded it
 */
export function activityPresentation(status: ActivityStatus, source?: string | null): Presentation {
  const decided = source === "policy_evaluation";
  switch (status) {
    case "ALLOWED":
      return decided
        ? DECISION.ALLOW
        : { label: "Recorded", tone: "neutral", meaning: "The agent reported this action and Aegis recorded it. Aegis did not decide on it." };
    case "WARNING":
      return decided
        ? DECISION.ALERT
        : { label: "Recorded · flagged", tone: "warning", meaning: "The agent reported this action and Aegis recorded it, flagged as unusual. Aegis did not decide on it." };
    case "BLOCKED":
      return decided
        ? DECISION.BLOCK
        : { label: "Reported blocked", tone: "neutral", meaning: "The agent reports that its own guardrail stopped this. Aegis recorded the report; it did not decide." };
    case "APPROVAL_REQUIRED":
      return DECISION.REQUIRE_APPROVAL;
    case "FAILED":
      return { label: "Failed", tone: "risk", meaning: "The action reported an error." };
  }
}

export type ApprovalState =
  | "AWAITING"
  | "USABLE"
  | "CONSUMED"
  | "REJECTED"
  | "EXPIRED"
  | "EXPIRED_UNUSED"
  | "CANCELLED";

export type ApprovalFacts = {
  status: ApprovalStatus;
  expiresAt: Date | null;
  executionExpiresAt: Date | null;
  consumedAt: Date | null;
};

/**
 * The state an approval is REALLY in, derived from the same fields the backend
 * uses to decide whether it may be consumed (lib/approvals/binding.ts). An
 * approval is never presented as usable when it is expired or already spent,
 * even if its stored status is still "APPROVED" or "PENDING" (expiry is applied
 * lazily on read in the backend).
 */
export function approvalState(a: ApprovalFacts, now: Date): ApprovalState {
  switch (a.status) {
    case "REJECTED":
      return "REJECTED";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
      return a.expiresAt && a.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "AWAITING";
    case "APPROVED":
      if (a.consumedAt) return "CONSUMED";
      if (a.executionExpiresAt && a.executionExpiresAt.getTime() <= now.getTime()) return "EXPIRED_UNUSED";
      return "USABLE";
  }
}

export const APPROVAL: Record<ApprovalState, Presentation> = {
  AWAITING: { label: "Awaiting approval", tone: "approval", meaning: "A human has not decided yet. The request expires if nobody does." },
  USABLE: { label: "Approved · usable once", tone: "safe", meaning: "Approved for exactly one execution of this exact request, until its execution window closes." },
  CONSUMED: { label: "Consumed", tone: "neutral", meaning: "The approval was used for its one execution. It is no longer valid." },
  REJECTED: { label: "Rejected", tone: "blocked", meaning: "A human rejected this request." },
  EXPIRED: { label: "Expired", tone: "neutral", meaning: "Nobody decided before the deadline. It is no longer valid." },
  EXPIRED_UNUSED: { label: "Expired unused", tone: "neutral", meaning: "It was approved, but the execution window closed before it was used. It is no longer valid." },
  CANCELLED: { label: "Cancelled", tone: "neutral", meaning: "The request was cancelled." },
};

export const AGENT_STATE: Record<AgentStatus, Presentation> = {
  ACTIVE: { label: "Active", tone: "safe", meaning: "Aegis answers this agent's authorization requests normally." },
  PAUSED: { label: "Paused", tone: "warning", meaning: "Kill switch (temporary): Aegis refuses every authorization request this agent makes until an operator resumes it." },
  STOPPED: { label: "Stopped", tone: "blocked", meaning: "Kill switch: Aegis refuses every authorization request this agent makes. Only a security responder can resume it." },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "warning", meaning: "Flagged by an operator for review. It still evaluates normally." },
  ARCHIVED: { label: "Retired", tone: "neutral", meaning: "Archived. Aegis refuses its requests and it can no longer be controlled." },
};

export const TRUST: Record<TrustState, Presentation> = {
  TRUSTED: { label: "Trusted", tone: "safe", meaning: "Behavior and history support extra latitude." },
  NORMAL: { label: "Normal", tone: "neutral", meaning: "Nothing recorded lowers this agent's trust." },
  DEGRADED: { label: "Degraded", tone: "warning", meaning: "Recent evidence lowered trust." },
  HIGH_RISK: { label: "High risk", tone: "risk", meaning: "Substantial recent adverse evidence." },
  RESTRICTED: { label: "Restricted", tone: "blocked", meaning: "The agent is stopped/paused or its trust is at the floor. Trust itself is advisory: it blocks nothing on its own." },
};

export const RISK: Record<RiskLevel, Presentation> = {
  LOW: { label: "Low", tone: "neutral", meaning: "No risk signal reached MEDIUM." },
  MEDIUM: { label: "Medium", tone: "warning", meaning: "At least one MEDIUM risk signal." },
  HIGH: { label: "High", tone: "risk", meaning: "A HIGH signal, or independent evidence from several sources agrees." },
  CRITICAL: { label: "Critical", tone: "blocked", meaning: "The highest assessed risk." },
};

/** The words that must never describe a single event, because the data model cannot back them. */
export const FORBIDDEN_CLAIMS = [/\benforced\b/i, /\bprevented\b/i, /\bstopped the action\b/i, /\bprotected\b/i, /\bneutralized\b/i, /\bmitigated\b/i];
