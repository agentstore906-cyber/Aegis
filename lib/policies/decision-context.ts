import type { AgentStatus, Environment, RiskLevel } from "@prisma/client";

import type { MatchingMode } from "@/lib/policies/matcher";
import type { PolicyEvaluationInput } from "@/lib/policies/types";
import { maxRiskLevel, scoreEventRisk } from "@/lib/security/risk-scoring";

/**
 * Builds the context the policy engine actually matches against (P0 —
 * docs/AEGIS_P0_IMPLEMENTATION.md §2). Pure, so every rule is unit-tested.
 *
 * Principle: never let a caller declare its own security-sensitive context
 * when Aegis holds a trusted server-side value.
 *
 *   environment  The Agent record's environment (set by an org member in the
 *                dashboard) is authoritative for agent callers. A different
 *                caller-claimed value is ignored for matching and kept only
 *                as evidence (`claimedEnvironment`). Dashboard operators
 *                (the policy tester) may pick one explicitly, since that is
 *                a human simulating a scenario, not an agent vouching for
 *                itself.
 *   riskLevel    A floor, never a ceiling: max(caller claim, the agent's
 *                configured risk level, Aegis's own rule-based score of the
 *                action/resource). A caller can raise risk, never lower it.
 *                A lower claim is kept as evidence (`claimedRiskLevel`).
 *
 * LEGACY matching mode (Organization.legacyPolicyMatching) returns the
 * caller's input untouched — the pre-P0 behavior, kept only as an audited
 * migration escape hatch.
 */
export type DecisionContext = {
  matchInput: PolicyEvaluationInput;
  claimedEnvironment?: Environment;
  claimedRiskLevel?: RiskLevel;
};

export function buildDecisionContext(
  input: PolicyEvaluationInput,
  agent: { environment: Environment; riskLevel: RiskLevel },
  mode: MatchingMode
): DecisionContext {
  if (mode === "LEGACY") return { matchInput: input };

  const operatorSupplied = input.contextSource === "operator";
  const environment = operatorSupplied ? (input.environment ?? agent.environment) : agent.environment;
  const claimedEnvironment =
    !operatorSupplied && input.environment && input.environment !== agent.environment ? input.environment : undefined;

  const scored = scoreEventRisk({
    eventType: input.eventType ?? "ACTION",
    action: input.action,
    resource: input.resource,
    status: "SUCCESS",
  }).level;
  const riskLevel = maxRiskLevel(maxRiskLevel(input.riskLevel ?? "LOW", agent.riskLevel), scored);
  const claimedRiskLevel = input.riskLevel && input.riskLevel !== riskLevel ? input.riskLevel : undefined;

  return {
    matchInput: { ...input, environment, riskLevel },
    claimedEnvironment,
    claimedRiskLevel,
  };
}

/**
 * Kill-switch states. An agent in any of these must never be told ALLOW:
 * Aegis refuses every authorization request it makes. PAUSED is treated
 * exactly like STOPPED (the safest explicit behavior — "paused" means "do
 * not act"); STOPPED remains the stronger operator signal in the audit
 * trail. NEEDS_ATTENTION is a review flag, not a halt, and evaluates
 * normally.
 */
const HALTED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>(["STOPPED", "PAUSED", "ARCHIVED"]);

export function isAgentHalted(status: AgentStatus): boolean {
  return HALTED_STATUSES.has(status);
}
