import type {
  ActivityType,
  AgentStatus,
  DataClass,
  DestinationKind,
  ConditionOperator,
  Environment,
  PolicyDecision,
  RiskLevel,
  SecurityAlertSeverity,
} from "@prisma/client";
import type { SafeJsonValue } from "@/lib/policies/safe-context";
import type { RiskAssessment } from "@/lib/risk/types";

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
  /**
   * An APPROVED approval request this call wants to use for its single
   * execution. Only consulted when policy resolves to REQUIRE_APPROVAL; must
   * match this exact request (see lib/approvals/binding.ts).
   */
  approvalRequestId?: string;
  /**
   * Who supplied the context fields. "agent" (default) = an external caller
   * whose environment claim is NOT trusted over the Agent record;
   * "operator" = an authenticated org member in the dashboard (policy
   * tester) explicitly simulating an environment. See decision-context.ts.
   */
  contextSource?: "agent" | "operator";
  /**
   * P1 structured telemetry about the action being authorized — already
   * normalized at the API boundary (lib/validation/api.ts). Stored on the
   * decision's ActivityEvent and bound into the approval fingerprint; not
   * (yet) available to policy conditions.
   */
  telemetry?: DecisionTelemetry;
  /** The authenticated API key's agent binding (P0 §7), if any — constrains parent references. */
  apiKeyAgentId?: string | null;
};

export type DecisionTelemetry = {
  service?: string;
  destination?: { destination: string; kind: DestinationKind };
  /** Raw end-user id — pseudonymized before storage, never persisted. */
  endUserId?: string;
  dataClasses?: DataClass[];
  dataSensitivity?: RiskLevel;
  recordCount?: number;
  byteCount?: number;
  parentEventId?: string;
  parentClientEventId?: string;
};

/** Which stage of the decision pipeline produced the final decision (RISK: the org's risk control made it stricter than policy). */
export type DecisionSource = "CONTROL" | "POLICY" | "DEFAULT_DENY" | "APPROVAL" | "RISK";

export type JsonPrimitive = string | number | boolean | null;

export type MatchedPolicySnapshot = {
  id: string;
  name: string;
  decision: PolicyDecision;
  priority: number;
  severity: SecurityAlertSeverity;
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
  /** Set when this evaluation created/updated a SecurityAlert (decision === ALERT). */
  alertId?: string;
  traceId: string;
  /** Which stage decided: kill switch, policy, default deny, or an approval check. */
  decisionSource: DecisionSource;
  /** The agent's control state at decision time. */
  agentStatus: AgentStatus;
  /** What policy alone resolved to, before the kill switch / approval checks. */
  policyDecision: PolicyDecision;
  matchingMode: "STRICT" | "LEGACY";
  /** The environment / risk level policies were actually matched against. */
  effectiveEnvironment?: Environment;
  effectiveRiskLevel?: RiskLevel;
  /** Deadline for a human decision, when this evaluation returned REQUIRE_APPROVAL. */
  approvalExpiresAt?: Date;
  /** Set when an approval was consumed by this evaluation (decision ALLOW, source APPROVAL). */
  consumedApprovalRequestId?: string;
  /** Machine-readable reason a referenced approval could not be used. */
  approvalDenialCode?: string;
  /**
   * P4 shadow risk assessment (lib/risk). Informational: it never influenced
   * `decision`, and the public API deliberately does not return it to agents.
   */
  riskAssessment?: RiskAssessment;
};

export { type ConditionOperator, type PolicyDecision };
