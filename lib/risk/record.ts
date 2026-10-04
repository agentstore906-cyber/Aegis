import type { PolicyDecision, RiskControlMode, RiskLevel } from "@prisma/client";

import type { RiskControlConfig, RiskControlOutcome, RiskControlPlan } from "@/lib/risk/control";
import type { RiskAssessment } from "@/lib/risk/types";

/**
 * The control record stored with EVERY evaluation (PolicyEvaluation.riskControl)
 * from P5 on, whatever the mode. Together with the row itself it answers, for
 * any decision: what was decided and why (decision / reason columns), which
 * policy (matchedPolicy* columns + policyDecision), which risk signals, the
 * agent's trust state, when (createdAt / decidedAt), and the execution
 * identifier (the evaluation id — what the agent attaches to the execution it
 * reports via POST /api/v1/events — plus the trace id).
 */
export type RiskControlRecord = {
  version: 1;
  configuredMode: RiskControlMode;
  /** The mode actually applied; differs from configured only when globally disabled. */
  effectiveMode: RiskControlMode;
  globallyDisabled: boolean;
  config: { mediumAction: PolicyDecision; highAction: PolicyDecision };
  outcome: RiskControlOutcome;
  /** What permissions and policies alone resolved to. */
  policyDecision: PolicyDecision;
  /** Null when no assessment could be produced. */
  riskLevel: RiskLevel | null;
  /** Level → decision per the organization's mapping, before any mode cap. */
  riskDecision: PolicyDecision | null;
  /** What risk was allowed to contribute under the effective mode (ALLOW = nothing). */
  enforcedByRisk: PolicyDecision;
  cappedByMode: boolean;
  finalDecision: PolicyDecision;
  finalSource: string;
  trust: { state: string; score: number; evaluatedAt: string } | null;
  /** Compact signal list; the full explanation is PolicyEvaluation.riskAssessment. */
  signals: { code: string; family: string; severity: string }[];
  decidedAt: string;
  traceId: string;
};

export function buildControlRecord(params: {
  plan: RiskControlPlan;
  config: RiskControlConfig;
  outcome: RiskControlOutcome;
  policyDecision: PolicyDecision;
  finalDecision: PolicyDecision;
  finalSource: string;
  assessment: RiskAssessment | null;
  decidedAt: Date;
  traceId: string;
}): RiskControlRecord {
  const { plan, config, assessment } = params;
  const trust = assessment?.context.trust;
  return {
    version: 1,
    configuredMode: plan.configuredMode,
    effectiveMode: plan.effectiveMode,
    globallyDisabled: plan.globallyDisabled,
    config: { mediumAction: config.mediumAction, highAction: config.highAction },
    outcome: params.outcome,
    policyDecision: params.policyDecision,
    riskLevel: assessment?.level ?? null,
    riskDecision: plan.riskDecision,
    enforcedByRisk: plan.enforceable,
    cappedByMode: plan.cappedByMode,
    finalDecision: params.finalDecision,
    finalSource: params.finalSource,
    trust:
      trust && trust.status === "used" && trust.state !== undefined && trust.score !== undefined && trust.evaluatedAt
        ? { state: trust.state, score: trust.score, evaluatedAt: trust.evaluatedAt }
        : null,
    signals: (assessment?.reasons ?? []).map((r) => ({ code: r.code, family: r.family, severity: r.severity })),
    decidedAt: params.decidedAt.toISOString(),
    traceId: params.traceId,
  };
}
