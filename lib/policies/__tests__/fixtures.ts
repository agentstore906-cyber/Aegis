import type { AgentPermission, PolicyCondition, PolicyDecision, PolicyStatus } from "@prisma/client";
import type { PolicyWithConditions } from "@/lib/policies/matcher";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function makeCondition(overrides: Partial<PolicyCondition> = {}): PolicyCondition {
  return {
    id: nextId("cond"),
    policyId: overrides.policyId ?? "policy_1",
    field: "context.amount",
    operator: "GREATER_THAN",
    value: 500,
    createdAt: new Date(),
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<PolicyWithConditions> = {}): PolicyWithConditions {
  return {
    id: nextId("policy"),
    organizationId: "org_1",
    name: "Test policy",
    description: null,
    status: "ACTIVE" as PolicyStatus,
    priority: 100,
    decision: "BLOCK" as PolicyDecision,
    agentId: null,
    action: "customer.delete",
    resource: null,
    environment: null,
    tool: null,
    riskLevel: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    conditions: [],
    ...overrides,
  };
}

export function makePermission(overrides: Partial<AgentPermission> = {}): AgentPermission {
  return {
    id: nextId("perm"),
    organizationId: "org_1",
    agentId: "agent_1",
    action: "invoice.read",
    resource: "",
    decision: "ALLOW" as PolicyDecision,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export const AGENT_1 = "agent_1";
export const AGENT_2 = "agent_2";

export function makeInput(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    organizationId: "org_1",
    agentId: AGENT_1,
    action: "refund.issue",
    ...overrides,
  };
}
