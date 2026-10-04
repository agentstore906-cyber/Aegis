import type { DataClass, Environment, EventOutcome, PolicyDecision, RiskLevel } from "@prisma/client";

/**
 * Risk signals recorded on an event (P1). These are *observations made at
 * the moment of ingest/decision*, stored as evidence for later behavioral and
 * risk analysis — not a risk score, and they don't change any decision.
 * Every signal is deterministic and names exactly what was observed. Pure, so
 * every rule is unit-tested.
 */
export type RiskSignal = { code: RiskSignalCode; detail?: Record<string, unknown> };

export type RiskSignalCode =
  | "risk_rule"
  | "agent_risk_floor"
  | "claimed_risk_lower"
  | "claimed_environment_ignored"
  | "sensitive_data"
  | "secret_shaped_fields"
  | "secret_values_redacted"
  | "executed_despite_decision";

const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function buildRiskSignals(input: {
  scoredRule: string | null;
  scoredLevel: RiskLevel;
  agentRiskLevel: RiskLevel;
  claimedRiskLevel?: RiskLevel;
  effectiveRiskLevel?: RiskLevel;
  claimedEnvironment?: Environment;
  effectiveEnvironment?: Environment;
  dataClasses: DataClass[];
  dataSensitivity: RiskLevel | null;
  secretShapedFieldCount: number;
  secretValueRedactions: { count: number; kinds: string[] };
  /** For a reported execution linked to an /evaluate decision. */
  evaluationDecision?: PolicyDecision | null;
  outcome?: EventOutcome | null;
}): RiskSignal[] {
  const signals: RiskSignal[] = [];

  if (input.scoredRule) signals.push({ code: "risk_rule", detail: { rule: input.scoredRule, level: input.scoredLevel } });

  if (LEVEL_RANK[input.agentRiskLevel] > LEVEL_RANK[input.scoredLevel]) {
    signals.push({ code: "agent_risk_floor", detail: { agentRiskLevel: input.agentRiskLevel } });
  }

  if (input.claimedRiskLevel && input.effectiveRiskLevel && input.claimedRiskLevel !== input.effectiveRiskLevel) {
    signals.push({ code: "claimed_risk_lower", detail: { claimed: input.claimedRiskLevel, effective: input.effectiveRiskLevel } });
  }

  if (input.claimedEnvironment && input.effectiveEnvironment && input.claimedEnvironment !== input.effectiveEnvironment) {
    signals.push({
      code: "claimed_environment_ignored",
      detail: { claimed: input.claimedEnvironment, effective: input.effectiveEnvironment },
    });
  }

  if (input.dataSensitivity && LEVEL_RANK[input.dataSensitivity] >= LEVEL_RANK.HIGH) {
    signals.push({ code: "sensitive_data", detail: { sensitivity: input.dataSensitivity, dataClasses: input.dataClasses } });
  }

  if (input.secretShapedFieldCount > 0) {
    signals.push({ code: "secret_shaped_fields", detail: { count: input.secretShapedFieldCount } });
  }

  if (input.secretValueRedactions.count > 0) {
    signals.push({
      code: "secret_values_redacted",
      detail: { count: input.secretValueRedactions.count, kinds: input.secretValueRedactions.kinds },
    });
  }

  // The agent reported completing an action under a decision that did not
  // permit it outright. Recorded as an observation only (P1 builds data, not
  // detections); a reported FAILURE/BLOCKED outcome means it didn't go through.
  if (
    input.evaluationDecision &&
    (input.evaluationDecision === "BLOCK" || input.evaluationDecision === "REQUIRE_APPROVAL") &&
    (input.outcome === "SUCCESS" || input.outcome === "WARNING")
  ) {
    signals.push({ code: "executed_despite_decision", detail: { decision: input.evaluationDecision, outcome: input.outcome } });
  }

  return signals;
}
