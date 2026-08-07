import type { ConditionOperator, Environment, PolicyDecision, RiskLevel } from "@prisma/client";

const OPERATOR_TEXT: Record<ConditionOperator, string> = {
  EQUALS: "is",
  NOT_EQUALS: "is not",
  GREATER_THAN: "is greater than",
  GREATER_THAN_OR_EQUAL: "is at least",
  LESS_THAN: "is less than",
  LESS_THAN_OR_EQUAL: "is at most",
  IN: "is one of",
  NOT_IN: "is not one of",
  EXISTS: "is present",
};

const DECISION_TEXT: Record<PolicyDecision, string> = {
  ALLOW: "allow it",
  REQUIRE_APPROVAL: "require approval",
  BLOCK: "block it",
};

function friendlyFieldName(field: string): string {
  return field.startsWith("context.") ? field.slice("context.".length) : field;
}

export function describeCondition(condition: {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}): string {
  const name = friendlyFieldName(condition.field);
  if (condition.operator === "EXISTS") return `${name} is present`;
  if (condition.operator === "IN" || condition.operator === "NOT_IN") {
    const values = Array.isArray(condition.value) ? condition.value.join(", ") : String(condition.value);
    return `${name} ${OPERATOR_TEXT[condition.operator]} [${values}]`;
  }
  return `${name} ${OPERATOR_TEXT[condition.operator]} ${JSON.stringify(condition.value)}`;
}

/** Builds the live "When ... , decision" preview shown under the policy builder. */
export function describePolicy(policy: {
  agentName?: string | null;
  action: string;
  resource?: string | null;
  environment?: Environment | null;
  tool?: string | null;
  riskLevel?: RiskLevel | null;
  decision: PolicyDecision;
  conditions: { field: string; operator: ConditionOperator; value: unknown }[];
}): string {
  const who = policy.agentName ? policy.agentName : "any agent";
  const scopeParts = [`requests "${policy.action}"`];
  if (policy.resource) scopeParts.push(`on "${policy.resource}"`);
  if (policy.environment) scopeParts.push(`in ${policy.environment.toLowerCase()}`);
  if (policy.tool) scopeParts.push(`via ${policy.tool}`);
  if (policy.riskLevel) scopeParts.push(`with ${policy.riskLevel.toLowerCase()} risk`);

  const conditionParts = policy.conditions.map(describeCondition);
  const allParts = [...scopeParts, ...conditionParts];

  return `When ${who} ${allParts.join(" and ")}, ${DECISION_TEXT[policy.decision]}.`;
}
