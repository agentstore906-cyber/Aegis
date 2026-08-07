import type { AgentPermission, Policy, PolicyCondition } from "@prisma/client";
import { evaluateOperator, resolveField } from "@/lib/policies/conditions";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

export type PolicyWithConditions = Policy & { conditions: PolicyCondition[] };

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

/** Scope fields (agent/action/resource/environment/tool/riskLevel). Unset fields match anything. */
export function policyScopeMatches(policy: Policy, input: PolicyEvaluationInput): boolean {
  if (policy.agentId && policy.agentId !== input.agentId) return false;
  if (!actionMatches(policy.action, input.action)) return false;
  if (policy.resource && policy.resource !== input.resource) return false;
  if (policy.environment && policy.environment !== input.environment) return false;
  if (policy.tool && policy.tool !== input.tool) return false;
  if (policy.riskLevel && policy.riskLevel !== input.riskLevel) return false;
  return true;
}

/** All conditions on a policy are combined with AND. No conditions = scope alone is sufficient. */
export function conditionsMatch(conditions: PolicyCondition[], input: PolicyEvaluationInput): boolean {
  return conditions.every((condition) => {
    const resolved = resolveField(condition.field, input);
    return evaluateOperator(condition.operator, resolved, condition.value);
  });
}

export function policyMatches(policy: PolicyWithConditions, input: PolicyEvaluationInput): boolean {
  return policyScopeMatches(policy, input) && conditionsMatch(policy.conditions, input);
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
  input: PolicyEvaluationInput
): PolicyWithConditions[] {
  return policies.filter((policy) => policy.status === "ACTIVE" && policyMatches(policy, input));
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
 */
export function resolveBestPermission(
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
