import type { AgentPermission, Policy, PolicyCondition, PolicyDecision, RiskLevel } from "@prisma/client";
import { evaluateConditionStrict, evaluateOperator, resolveField } from "@/lib/policies/conditions";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

export type PolicyWithConditions = Policy & { conditions: PolicyCondition[] };

/**
 * STRICT (default, P0) vs LEGACY (pre-P0, per-org opt-out via
 * Organization.legacyPolicyMatching) matching. See docs/policy-engine.md
 * "Missing and unusable fields" for the full rules.
 */
export type MatchingMode = "STRICT" | "LEGACY";

/**
 * Restrictive decisions fail closed on unknown input: if the caller didn't
 * supply a field a BLOCK / REQUIRE_APPROVAL / ALERT policy is scoped or
 * conditioned on, Aegis assumes the policy applies. ALLOW fails the other
 * way — an ALLOW rule never matches on something Aegis couldn't verify.
 * Either way, omitting information can only make a decision stricter.
 */
export function isRestrictiveDecision(decision: PolicyDecision): boolean {
  return decision !== "ALLOW";
}

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Exact match, or a simple "prefix.*" wildcard. Nothing more elaborate —
 * see docs/policy-engine.md for why full glob/regex was deliberately left
 * out of Phase 2.
 */
export function actionMatches(pattern: string, action: string): boolean {
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1); // "crm.*" -> "crm."
    return action.startsWith(prefix);
  }
  return pattern === action;
}

/** Pre-P0 scope matching, kept verbatim for LEGACY mode. */
function legacyScopeMatches(policy: Policy, input: PolicyEvaluationInput): boolean {
  if (policy.resource && policy.resource !== input.resource) return false;
  if (policy.environment && policy.environment !== input.environment) return false;
  if (policy.tool && policy.tool !== input.tool) return false;
  if (policy.riskLevel && policy.riskLevel !== input.riskLevel) return false;
  return true;
}

function strictScopeMatches(policy: Policy, input: PolicyEvaluationInput): boolean {
  const restrictive = isRestrictiveDecision(policy.decision);

  // A scoped field the input doesn't carry: restrictive -> applies, ALLOW -> doesn't.
  const scoped = (policyValue: string | null, inputValue: string | undefined) => {
    if (!policyValue) return true;
    if (inputValue === undefined || inputValue === null || inputValue === "") return restrictive;
    return policyValue === inputValue;
  };

  if (!scoped(policy.resource, input.resource)) return false;
  if (!scoped(policy.environment, input.environment)) return false;
  if (!scoped(policy.tool, input.tool)) return false;

  if (policy.riskLevel) {
    if (!input.riskLevel) return restrictive;
    // Restrictive risk scopes are thresholds ("HIGH" = HIGH or worse), so a
    // more dangerous action can't escape a rule written for a milder one.
    // ALLOW risk scopes stay exact — never widened to cover riskier actions.
    if (restrictive) {
      if (RISK_RANK[input.riskLevel] < RISK_RANK[policy.riskLevel]) return false;
    } else if (policy.riskLevel !== input.riskLevel) {
      return false;
    }
  }
  return true;
}

/** Scope fields (agent/action/resource/environment/tool/riskLevel). Unset policy fields match anything. */
export function policyScopeMatches(
  policy: Policy,
  input: PolicyEvaluationInput,
  mode: MatchingMode = "STRICT"
): boolean {
  if (policy.agentId && policy.agentId !== input.agentId) return false;
  if (!actionMatches(policy.action, input.action)) return false;
  return mode === "LEGACY" ? legacyScopeMatches(policy, input) : strictScopeMatches(policy, input);
}

/**
 * All conditions on a policy are combined with AND. No conditions = scope
 * alone is sufficient. In STRICT mode an indeterminate condition (missing or
 * non-comparable field) counts as matched for restrictive policies and as
 * not matched for ALLOW — see evaluateConditionStrict.
 */
export function conditionsMatch(
  conditions: PolicyCondition[],
  input: PolicyEvaluationInput,
  mode: MatchingMode = "STRICT",
  decision: PolicyDecision = "ALLOW"
): boolean {
  const restrictive = isRestrictiveDecision(decision);
  return conditions.every((condition) => {
    const resolved = resolveField(condition.field, input);
    if (mode === "LEGACY") return evaluateOperator(condition.operator, resolved, condition.value);
    const result = evaluateConditionStrict(condition.operator, resolved, condition.value);
    return result === null ? restrictive : result;
  });
}

export function policyMatches(
  policy: PolicyWithConditions,
  input: PolicyEvaluationInput,
  mode: MatchingMode = "STRICT"
): boolean {
  return policyScopeMatches(policy, input, mode) && conditionsMatch(policy.conditions, input, mode, policy.decision);
}

/**
 * Filters a candidate list down to policies that actually apply: active
 * status, matching scope, and matching conditions. `listActivePoliciesForEvaluation`
 * already narrows by status at the query level — this re-checks it
 * defensively so the guarantee ("a disabled policy can never affect a
 * decision") holds even if a caller passes in an unfiltered list.
 */
export function filterApplicablePolicies(
  policies: PolicyWithConditions[],
  input: PolicyEvaluationInput,
  mode: MatchingMode = "STRICT"
): PolicyWithConditions[] {
  return policies.filter((policy) => policy.status === "ACTIVE" && policyMatches(policy, input, mode));
}

/**
 * Baseline permission resolution order (most to least specific):
 *   1. exact action + exact resource
 *   2. exact action + any resource ("")
 *   3. wildcard action ("prefix.*") + exact resource
 *   4. wildcard action + any resource
 * Exact-action rows always outrank wildcard-action rows regardless of
 * resource specificity, so a targeted permission can't be shadowed by a
 * broad one covering the same action family.
 *
 * Omitted resource (STRICT): the caller can't be credited with a
 * resource-specific *grant* it didn't name, but it also can't dodge a
 * resource-specific *restriction* by not naming the resource. So when
 * `resource` is omitted, a resource-scoped BLOCK / REQUIRE_APPROVAL / ALERT
 * permission for this action is weighed against the best any-resource row
 * and the stricter of the two wins. LEGACY mode keeps the pre-P0 behavior
 * (resource-scoped rows simply don't apply).
 */
export function resolveBestPermission(
  permissions: AgentPermission[],
  input: PolicyEvaluationInput,
  mode: MatchingMode = "STRICT"
): AgentPermission | undefined {
  const best = resolveMostSpecificPermission(permissions, input);
  if (mode === "LEGACY" || (input.resource !== undefined && input.resource !== "")) return best;

  const restrictiveScoped = permissions
    .filter((p) => p.resource !== "" && isRestrictiveDecision(p.decision) && actionMatches(p.action, input.action))
    .sort((a, b) => DECISION_STRICTNESS[b.decision] - DECISION_STRICTNESS[a.decision]);
  const strictestScoped = restrictiveScoped[0];
  if (!strictestScoped) return best;
  if (!best) return strictestScoped;
  return DECISION_STRICTNESS[strictestScoped.decision] > DECISION_STRICTNESS[best.decision] ? strictestScoped : best;
}

const DECISION_STRICTNESS: Record<PolicyDecision, number> = { BLOCK: 4, REQUIRE_APPROVAL: 3, ALERT: 2, ALLOW: 1 };

function resolveMostSpecificPermission(
  permissions: AgentPermission[],
  input: PolicyEvaluationInput
): AgentPermission | undefined {
  const resource = input.resource ?? "";

  const applicable = permissions.filter((p) => actionMatches(p.action, input.action));
  if (applicable.length === 0) return undefined;

  const rank = (p: AgentPermission): number => {
    const exactAction = p.action === input.action;
    const exactResource = p.resource !== "" && p.resource === resource;
    const anyResource = p.resource === "";

    if (exactAction && exactResource) return 0;
    if (exactAction && anyResource) return 1;
    if (!exactAction && exactResource) return 2;
    if (!exactAction && anyResource) return 3;
    return 99; // resource is set but doesn't match input — not actually applicable
  };

  const ranked = applicable
    .map((p) => ({ p, rank: rank(p) }))
    .filter(({ rank: r }) => r < 99)
    .sort((a, b) => a.rank - b.rank);

  return ranked[0]?.p;
}
