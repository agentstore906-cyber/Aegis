import type {
  ActivityType,
  ConditionOperator,
  Environment,
  PolicyDecision,
  RiskLevel,
} from "@prisma/client";
import type { SafeJsonValue } from "@/lib/policies/safe-context";

/**
 * Input to evaluateAgentAction(). organizationId must always come from
 * trusted server-side context (the caller's active membership or an
 * authenticated agent identity) — never from a client-supplied value.
 */
export type PolicyEvaluationInput = {
  organizationId: string;
  agentId: string;
  action: string;
  resource?: string;
  environment?: Environment;
  tool?: string;
  riskLevel?: RiskLevel;
  /** Arbitrary business context (e.g. { amount: 1250 }). Treated as pure data — see conditions.ts. */
  context?: Record<string, SafeJsonValue>;
  /** Correlates this evaluation with a broader chain of activity. Generated if omitted. */
  traceId?: string;
  /** Classifies the ActivityEvent created alongside this evaluation. Defaults to "ACTION". */
  eventType?: ActivityType;
};

export type JsonPrimitive = string | number | boolean | null;

export type MatchedPolicySnapshot = {
  id: string;
  name: string;
  decision: PolicyDecision;
  priority: number;
};

export type PermissionSnapshot = {
  id: string;
  action: string;
  resource: string;
  decision: PolicyDecision;
};

/**
 * Structured, explainable result of one evaluation. Never collapse this to
 * a boolean — every consumer (UI, future SDK, audit) needs the reasoning.
 */
export type PolicyEvaluationResult = {
  decision: PolicyDecision;
  reason: string;
  matchedPolicyIds: string[];
  matchedPolicySnapshots: MatchedPolicySnapshot[];
  matchedPermissionId?: string;
  matchedPermissionSnapshot?: PermissionSnapshot;
  evaluationId: string;
  /** Set when this evaluation created an ApprovalRequest (decision === REQUIRE_APPROVAL). */
  approvalRequestId?: string;
  traceId: string;
};

export { type ConditionOperator, type PolicyDecision };
