import type { AgentPermission, PolicyDecision } from "@prisma/client";
import { resolveField } from "@/lib/policies/conditions";
import type { PolicyWithConditions } from "@/lib/policies/matcher";
import type {
  MatchedPolicySnapshot,
  PermissionSnapshot,
  PolicyEvaluationInput,
} from "@/lib/policies/types";

/**
 * Decision severity, strictest first. This ordering is the entire security
 * model of the engine: a single matching BLOCK always wins, regardless of
 * how many other rules would ALLOW. Fail closed.
 */
const SEVERITY: Record<PolicyDecision, number> = {
  BLOCK: 3,
  REQUIRE_APPROVAL: 2,
  ALLOW: 1,
};

const DECISION_VERB: Record<PolicyDecision, string> = {
  BLOCK: "Blocked",
  REQUIRE_APPROVAL: "Approval required",
  ALLOW: "Allowed",
};

export type ResolvedDecision = {
  decision: PolicyDecision;
  reason: string;
  matchedPolicySnapshots: MatchedPolicySnapshot[];
  matchedPermissionSnapshot?: PermissionSnapshot;
};

function friendlyFieldName(field: string): string {
  return field.startsWith("context.") ? field.slice("context.".length) : field;
}

function describeMatchedDetails(policy: PolicyWithConditions, input: PolicyEvaluationInput): string {
  const details = policy.conditions
    .map((condition) => {
      const resolved = resolveField(condition.field, input);
      if (resolved === undefined || resolved === null) return null;
      return `${friendlyFieldName(condition.field)} ${resolved}`;
    })
    .filter((v): v is string => v !== null)
    .join(", ");
  return details ? ` (${details})` : "";
}

/**
 * Combines a baseline permission with every policy that matched scope +
 * conditions into one deterministic decision. All matched policies are
 * recorded regardless of which one "wins" — conflicts are surfaced, never
 * hidden (see docs/policy-engine.md).
 */
export function resolveDecision(
  permission: AgentPermission | undefined,
  matchedPolicies: PolicyWithConditions[],
  input: PolicyEvaluationInput
): ResolvedDecision {
  const matchedPolicySnapshots: MatchedPolicySnapshot[] = matchedPolicies.map((p) => ({
    id: p.id,
    name: p.name,
    decision: p.decision,
    priority: p.priority,
  }));

  const matchedPermissionSnapshot: PermissionSnapshot | undefined = permission
    ? { id: permission.id, action: permission.action, resource: permission.resource, decision: permission.decision }
    : undefined;

  if (!permission && matchedPolicies.length === 0) {
    return {
      decision: "BLOCK",
      reason: `Blocked because no permission or policy matched "${input.action}". Unconfigured actions are blocked by default.`,
      matchedPolicySnapshots,
      matchedPermissionSnapshot,
    };
  }

  let strictest: PolicyDecision = permission?.decision ?? "ALLOW";
  for (const policy of matchedPolicies) {
    if (SEVERITY[policy.decision] > SEVERITY[strictest]) strictest = policy.decision;
  }
  if (permission && SEVERITY[permission.decision] > SEVERITY[strictest]) {
    strictest = permission.decision;
  }

  // Among policies at the winning severity, the highest-priority one drives the explanation.
  const winningPolicies = matchedPolicies
    .filter((p) => p.decision === strictest)
    .sort((a, b) => b.priority - a.priority);

  const winner = winningPolicies[0];

  const reason = winner
    ? `${DECISION_VERB[strictest]} because the active policy "${winner.name}" matched "${input.action}"${describeMatchedDetails(winner, input)}.`
    : `${DECISION_VERB[strictest]} because the baseline permission for "${input.action}" is set to ${strictest}.`;

  return { decision: strictest, reason, matchedPolicySnapshots, matchedPermissionSnapshot };
}
