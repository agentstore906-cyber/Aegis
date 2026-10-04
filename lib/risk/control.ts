import type { PolicyDecision, RiskControlMode, RiskLevel } from "@prisma/client";

import { DECISION_STRICTNESS } from "@/lib/risk/types";

/**
 * Risk-driven control (P5 — docs/AEGIS_P5_CONTROL.md). Pure: given an
 * organization's configuration, the assessed risk level and what policy
 * resolved to, decide what — if anything — risk adds to the decision.
 *
 * Precedence (strongest first), implemented across this file and
 * lib/policies/evaluate.ts:
 *   1. Kill switch      a halted agent is always BLOCK (decisionSource CONTROL)
 *   2. Explicit policy  risk can never weaken it; an explicit/default-deny
 *                       BLOCK is final and cannot be approved around
 *   3. Human approval   a consumed approval for this exact request is honored
 *                       over a risk gate (never over 1 or a policy BLOCK)
 *   4. Risk             may only ADD caution: strictest(policy, risk)
 *   5. Policy           everything else, exactly as before P5
 * Risk never turns a stricter policy decision into a weaker one, and a LOW
 * assessment adds nothing ("LOW → ALLOW" means "risk has no objection").
 */

export type RiskControlConfig = {
  mode: RiskControlMode;
  /** What a MEDIUM assessment maps to. */
  mediumAction: PolicyDecision;
  /** What a HIGH or CRITICAL assessment maps to. */
  highAction: PolicyDecision;
};

/** Every organization before it opts in: observe, with the P4 mapping. */
export const DEFAULT_RISK_CONTROL: RiskControlConfig = {
  mode: "OBSERVE",
  mediumAction: "ALERT",
  highAction: "REQUIRE_APPROVAL",
};

export const MEDIUM_ACTION_OPTIONS = ["ALLOW", "ALERT", "REQUIRE_APPROVAL"] as const satisfies readonly PolicyDecision[];
export const HIGH_ACTION_OPTIONS = ["REQUIRE_APPROVAL", "BLOCK"] as const satisfies readonly PolicyDecision[];

/** Returns an error message for a configuration that makes no sense, else null. */
export function validateRiskControlConfig(config: RiskControlConfig): string | null {
  if (!(MEDIUM_ACTION_OPTIONS as readonly string[]).includes(config.mediumAction)) {
    return "Medium risk can only map to Allow, Alert or Require approval.";
  }
  if (!(HIGH_ACTION_OPTIONS as readonly string[]).includes(config.highAction)) {
    return "High risk can only map to Require approval or Block.";
  }
  if (DECISION_STRICTNESS[config.highAction] < DECISION_STRICTNESS[config.mediumAction]) {
    return "High risk cannot be handled more leniently than medium risk.";
  }
  return null;
}

/** Operators can force every organization back to OBSERVE with AEGIS_RISK_CONTROL_DISABLED=1 (no data is touched). */
export function isRiskControlGloballyDisabled(source: Record<string, string | undefined> = process.env): boolean {
  const value = source.AEGIS_RISK_CONTROL_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export const strictest = (a: PolicyDecision, b: PolicyDecision): PolicyDecision => (DECISION_STRICTNESS[b] > DECISION_STRICTNESS[a] ? b : a);

/** Level → decision per the organization's configuration (before any mode cap). */
export function riskDecisionFor(level: RiskLevel, config: Pick<RiskControlConfig, "mediumAction" | "highAction">): PolicyDecision {
  switch (level) {
    case "LOW":
      return "ALLOW";
    case "MEDIUM":
      return config.mediumAction;
    case "HIGH":
    case "CRITICAL":
      return config.highAction;
  }
}

export type RiskControlOutcome =
  /** OBSERVE: assessed and compared, never applied. */
  | "OBSERVED"
  /** Enforcing, and risk had nothing to add to the policy decision. */
  | "NO_CHANGE"
  /** Risk made the decision stricter than policy alone. */
  | "ESCALATED"
  /** Risk would have gated the request, but a consumed human approval was honored. */
  | "APPROVAL_HONORED"
  /** Enforcement was on but no assessment could be produced; policy stood. */
  | "UNAVAILABLE"
  /** The kill switch decided; risk was not consulted for the decision. */
  | "KILL_SWITCH";

export type RiskControlPlan = {
  configuredMode: RiskControlMode;
  /** The mode actually applied (OBSERVE when globally disabled). */
  effectiveMode: RiskControlMode;
  globallyDisabled: boolean;
  /** Level → decision per configuration, uncapped — the shadow "recommended" basis. */
  riskDecision: PolicyDecision | null;
  /** What risk is allowed to add under the effective mode (ALLOW = nothing). */
  enforceable: PolicyDecision;
  /** True when the mode cap lowered riskDecision (e.g. BLOCK → REQUIRE_APPROVAL). */
  cappedByMode: boolean;
  /** strictest(policy, enforceable): the decision before kill switch / approval handling. */
  gate: PolicyDecision;
  /** True when the gate is stricter than policy alone. */
  escalated: boolean;
  /** Enforcement was requested but there was no assessment to apply. */
  unavailable: boolean;
};

export function planRiskControl(params: {
  config: RiskControlConfig;
  globallyDisabled: boolean;
  /** Null when no assessment could be produced. */
  level: RiskLevel | null;
  policyDecision: PolicyDecision;
}): RiskControlPlan {
  const { config, globallyDisabled, level, policyDecision } = params;
  const effectiveMode: RiskControlMode = globallyDisabled ? "OBSERVE" : config.mode;
  const riskDecision = level ? riskDecisionFor(level, config) : null;

  let enforceable: PolicyDecision = "ALLOW";
  let cappedByMode = false;
  if (effectiveMode !== "OBSERVE" && riskDecision) {
    if (effectiveMode === "APPROVAL_REQUIRED" && riskDecision === "BLOCK") {
      enforceable = "REQUIRE_APPROVAL";
      cappedByMode = true;
    } else {
      enforceable = riskDecision;
    }
  }

  const gate = strictest(policyDecision, enforceable);
  return {
    configuredMode: config.mode,
    effectiveMode,
    globallyDisabled,
    riskDecision,
    enforceable,
    cappedByMode,
    gate,
    escalated: gate !== policyDecision,
    unavailable: effectiveMode !== "OBSERVE" && riskDecision === null,
  };
}

/** The outcome label recorded with the decision, once the FINAL decision is known. */
export function controlOutcome(params: {
  plan: RiskControlPlan;
  halted: boolean;
  finalDecision: PolicyDecision;
  finalSource: string;
}): RiskControlOutcome {
  const { plan, halted, finalDecision, finalSource } = params;
  if (halted) return "KILL_SWITCH";
  if (plan.effectiveMode === "OBSERVE") return "OBSERVED";
  if (plan.unavailable) return "UNAVAILABLE";
  if (!plan.escalated) return "NO_CHANGE";
  // Escalated by risk. A consumed human approval is the one thing that lifts the gate; a still-pending or
  // invalid approval leaves the stricter decision in force.
  return finalSource === "APPROVAL" && finalDecision === "ALLOW" ? "APPROVAL_HONORED" : "ESCALATED";
}

/** Agent-facing sentence. Names the level and the mode, never the individual signals (those are operator evidence). */
export function riskGateReason(params: { plan: RiskControlPlan; level: RiskLevel; policyDecision: PolicyDecision; policyReason: string }): string {
  const { plan, level, policyDecision, policyReason } = params;
  const what =
    plan.gate === "BLOCK"
      ? "Blocked by Aegis risk control"
      : plan.gate === "REQUIRE_APPROVAL"
        ? "Approval required by Aegis risk control"
        : "Allowed with an alert from Aegis risk control";
  return (
    `${what}: this request was assessed as ${level} risk (risk control mode ${plan.effectiveMode}). ` +
    `Permissions and policies alone would have returned ${policyDecision}: ${policyReason}`
  );
}
