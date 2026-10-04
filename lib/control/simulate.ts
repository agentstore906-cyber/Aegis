import "server-only";

import type { Environment, PolicyDecision, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { filterApplicablePolicies, resolveBestPermission, type MatchingMode } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { listActivePoliciesForEvaluation } from "@/lib/policies/repository";
import { buildDecisionContext, isAgentHalted } from "@/lib/policies/decision-context";
import type { DecisionSource, MatchedPolicySnapshot, PolicyEvaluationInput } from "@/lib/policies/types";
import { APPROVAL_PENDING_TTL_MS } from "@/lib/approvals/binding";
import { redactSecretValues, redactSecrets } from "@/lib/security/redact";
import { scoreEventRisk } from "@/lib/security/risk-scoring";
import { normalizeKey, sensitivityForDataClasses } from "@/lib/telemetry/normalize";
import { pseudonymizeEndUser } from "@/lib/telemetry/pseudonymize";
import { buildShadow, composeRisk, finalizeAssessment } from "@/lib/risk/compose";
import { startRiskContext } from "@/lib/risk/context";
import { isRiskControlGloballyDisabled, planRiskControl, riskGateReason, type RiskControlConfig } from "@/lib/risk/control";
import type { RiskAssessment, RiskAssessmentCore } from "@/lib/risk/types";
import { getEnforcementCoverage, type EnforcementCoverage } from "@/lib/control/coverage";
import { getIdentityBindings, type IdentityBinding } from "@/lib/control/identity";

/**
 * Policy simulation: "what would Aegis do if this happened?" — answered from
 * READ-ONLY inputs, with NO side effects.
 *
 * It runs the same stages as evaluateAgentAction() (lib/policies/evaluate.ts),
 * in the same order, using the same pure/read-only building blocks (context
 * building, permission + policy resolution, risk composition, the risk-control
 * planner, the kill switch), and writes nothing: no evaluation, no activity
 * event, no approval request, no alert, no audit row, no baseline, no trust
 * recompute, no webhook. It never creates or consumes an approval. Tests
 * assert both properties — row counts unchanged, and decision/source/reason
 * identical to the real engine across a scenario matrix — so it cannot drift
 * silently.
 *
 * The result explains the decision stage by stage, in the order of the
 * documented precedence (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §3).
 */

export type SimulationInput = Omit<PolicyEvaluationInput, "approvalRequestId" | "traceId" | "apiKeyAgentId">;

export type SimulationStageName = "KILL_SWITCH" | "PERMISSION" | "POLICY" | "BEHAVIOR" | "TRUST" | "RISK" | "RISK_CONTROL" | "APPROVAL";

export type SimulationStage = {
  stage: SimulationStageName;
  /** Did this stage determine or change the outcome? */
  decisive: boolean;
  summary: string;
};

export type SimulationResult = {
  /** Always false. A simulation records nothing. */
  recorded: false;
  /** What Aegis would RETURN to the caller. */
  decision: PolicyDecision;
  decisionSource: DecisionSource;
  reason: string;
  /** What permissions and policies alone resolve to, before the kill switch and risk control. */
  policyDecision: PolicyDecision;
  matchingMode: MatchingMode;
  agent: {
    id: string;
    name: string;
    slug: string;
    owner: string;
    environment: Environment;
    status: string;
    configuredRiskLevel: RiskLevel;
    identity: IdentityBinding;
  };
  /** The environment and risk level the policies were actually matched against. */
  effective: { environment: Environment | undefined; riskLevel: RiskLevel | undefined; claimedEnvironmentIgnored: boolean; claimedRiskLevelRaised: boolean };
  matched: {
    permission: { id: string; action: string; resource: string; decision: PolicyDecision } | null;
    policies: MatchedPolicySnapshot[];
    defaultDeny: boolean;
  };
  behavior: { baseline: { version: number; maturity: string } | null; deviations: { kind: string; confidence: string; explanation: string }[] };
  trust: { state: string; score: number } | null;
  /** Null when the risk evidence could not be loaded in time (the real engine would proceed without it too). */
  risk: RiskAssessment | null;
  riskControl: { configuredMode: string; effectiveMode: string; globallyDisabled: boolean; riskDecision: PolicyDecision | null; enforceable: PolicyDecision; cappedByMode: boolean; escalated: boolean; unavailable: boolean };
  approval: {
    required: boolean;
    /** A real run would open an approval request; this simulation did not. */
    wouldOpenRequest: boolean;
    expiresInMs: number | null;
    /** Roles that can resolve it (capability `resolve_approvals`). */
    reviewerRoles: string[];
    note: string;
  };
  enforcement: {
    /** What Aegis would return — not what is guaranteed to happen next. */
    returns: PolicyDecision;
    mechanism: "decision-api";
    coverage: EnforcementCoverage;
    /** Plain statement of what this decision does and does not control. */
    note: string;
  };
  stages: SimulationStage[];
};

const REVIEWER_ROLES = ["OWNER", "ADMIN", "SECURITY"];

export class SimulationAgentNotFoundError extends Error {
  constructor() {
    super("Agent not found in this organization.");
    this.name = "SimulationAgentNotFoundError";
  }
}

export async function simulateAgentAction(input: SimulationInput): Promise<SimulationResult> {
  const now = new Date();
  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
    include: {
      organization: { select: { legacyPolicyMatching: true, riskControlMode: true, riskMediumAction: true, riskHighAction: true } },
    },
  });
  if (!agent) throw new SimulationAgentNotFoundError();

  const telemetry = input.telemetry ?? {};
  const matchingMode: MatchingMode = agent.organization.legacyPolicyMatching ? "LEGACY" : "STRICT";
  const { matchInput, claimedEnvironment, claimedRiskLevel } = buildDecisionContext(input as PolicyEvaluationInput, agent, matchingMode);

  // Evidence loading overlaps the policy queries, exactly as in the real engine. Read-only; never rejects.
  const endUserHash = telemetry.endUserId ? pseudonymizeEndUser(input.organizationId, telemetry.endUserId) : null;
  const riskContextPromise = startRiskContext({
    organizationId: input.organizationId,
    agentId: input.agentId,
    action: input.action,
    eventType: input.eventType ?? "ACTION",
    toolKey: normalizeKey(input.tool),
    service: telemetry.service ?? null,
    destination: telemetry.destination?.destination ?? null,
    dataClasses: telemetry.dataClasses ?? [],
    endUserHash,
    recordCount: telemetry.recordCount ?? null,
    byteCount: telemetry.byteCount ?? null,
    parentEventId: null,
    now,
  });

  const [permissions, candidatePolicies, identity, coverage] = await Promise.all([
    prisma.agentPermission.findMany({ where: { organizationId: input.organizationId, agentId: input.agentId } }),
    listActivePoliciesForEvaluation(input.organizationId, input.agentId),
    getIdentityBindings(input.organizationId, [agent.id], now),
    getEnforcementCoverage(input.organizationId, [agent.id], { days: 7, now }),
  ]);

  const permission = resolveBestPermission(permissions, matchInput, matchingMode);
  const matchedPolicies = filterApplicablePolicies(candidatePolicies, matchInput, matchingMode);
  const resolved = resolveDecision(permission, matchedPolicies, matchInput);

  const dataClasses = telemetry.dataClasses ?? [];
  const dataSensitivity = sensitivityForDataClasses(dataClasses, telemetry.dataSensitivity);
  const scored = scoreEventRisk({ eventType: input.eventType ?? "ACTION", action: input.action, resource: input.resource, status: "SUCCESS" });
  // Same redaction the real engine applies, so nothing sensitive is echoed back.
  redactSecretValues(input.context && Object.keys(input.context).length > 0 ? redactSecrets(input.context) : undefined);

  const riskContext = await riskContextPromise;
  let riskCore: RiskAssessmentCore | null = null;
  if (riskContext) {
    try {
      riskCore = composeRisk({
        action: input.action,
        policy: {
          policyDecision: resolved.decision,
          explicitRuleMatched: Boolean(permission) || matchedPolicies.length > 0,
          winningPolicy: resolved.winningPolicySnapshot,
          matchedPermission: resolved.matchedPermissionSnapshot,
        },
        request: { scoredRule: scored.rule, scoredLevel: scored.level, dataSensitivity, dataClasses },
        ...riskContext,
        now,
      });
    } catch {
      riskCore = null;
    }
  }

  const riskConfig: RiskControlConfig = {
    mode: agent.organization.riskControlMode,
    mediumAction: agent.organization.riskMediumAction,
    highAction: agent.organization.riskHighAction,
  };
  const plan = planRiskControl({ config: riskConfig, globallyDisabled: isRiskControlGloballyDisabled(), level: riskCore?.level ?? null, policyDecision: resolved.decision });
  const riskGated = plan.escalated && riskCore !== null;
  const halted = isAgentHalted(agent.status);

  let decision: PolicyDecision = plan.gate;
  let reason = riskGated && riskCore ? riskGateReason({ plan, level: riskCore.level, policyDecision: resolved.decision, policyReason: resolved.reason }) : resolved.reason;
  let decisionSource: DecisionSource = riskGated ? "RISK" : permission || matchedPolicies.length > 0 ? "POLICY" : "DEFAULT_DENY";
  if (halted) {
    decision = "BLOCK";
    decisionSource = "CONTROL";
    reason =
      `Blocked because agent "${agent.name}" is ${agent.status} — Aegis refuses every authorization request from a ` +
      `${agent.status.toLowerCase()} agent until an operator resumes it. ` +
      `(Policy alone would have returned ${resolved.decision}: ${resolved.reason})`;
  }

  const risk: RiskAssessment | null = riskCore
    ? finalizeAssessment(riskCore, buildShadow({ level: riskCore.level, actual: decision, humanApproved: false, riskDecision: plan.riskDecision ?? undefined }))
    : null;

  const defaultDeny = !permission && matchedPolicies.length === 0;
  const requiresApproval = decision === "REQUIRE_APPROVAL";
  const cov = coverage.get(agent.id)!;

  const stages: SimulationStage[] = [
    {
      stage: "KILL_SWITCH",
      decisive: halted,
      summary: halted ? `The agent is ${agent.status}: Aegis returns BLOCK before anything else is considered.` : `The agent is ${agent.status}: the kill switch does not apply.`,
    },
    {
      stage: "PERMISSION",
      decisive: Boolean(permission) && matchedPolicies.length === 0 && !halted,
      summary: permission ? `Permission "${permission.action}"${permission.resource ? ` on "${permission.resource}"` : ""} resolves to ${permission.decision}.` : "No agent permission matches this action.",
    },
    {
      stage: "POLICY",
      decisive: matchedPolicies.length > 0 && !halted,
      summary: matchedPolicies.length
        ? `${matchedPolicies.length} polic${matchedPolicies.length === 1 ? "y" : "ies"} matched (${matchedPolicies.map((p) => `${p.name} → ${p.decision}`).join("; ")}); permissions and policies together resolve to ${resolved.decision}.`
        : defaultDeny
          ? "No permission or policy covers this action, so the default is BLOCK (default deny)."
          : `No policy matched; the permission alone resolves to ${resolved.decision}.`,
    },
    {
      stage: "BEHAVIOR",
      decisive: false,
      summary: !riskContext?.baseline
        ? "No behavioral baseline is stored for this agent, so behavior was not compared."
        : riskContext.deviations.length
          ? `${riskContext.deviations.length} deviation${riskContext.deviations.length === 1 ? "" : "s"} from the ${riskContext.baseline.maturity.toLowerCase().replaceAll("_", " ")} baseline (v${riskContext.baseline.version}) — an input to risk, not a decision on its own.`
          : `Consistent with the ${riskContext.baseline.maturity.toLowerCase().replaceAll("_", " ")} baseline (v${riskContext.baseline.version}).`,
    },
    {
      stage: "TRUST",
      decisive: false,
      summary: riskContext?.trust ? `Agent trust is ${riskContext.trust.state.toLowerCase().replaceAll("_", " ")} (${riskContext.trust.score}/100) — an input to risk; trust never decides on its own.` : "No trust evaluation is stored for this agent.",
    },
    {
      stage: "RISK",
      decisive: false,
      summary: risk ? `${risk.headline} ${risk.reasons.slice(0, 3).map((r) => r.summary).join(" ")}`.trim() : "Risk could not be assessed (evidence unavailable); the real engine would proceed without it.",
    },
    {
      stage: "RISK_CONTROL",
      decisive: riskGated && !halted,
      summary:
        plan.effectiveMode === "OBSERVE"
          ? `Risk control is in OBSERVE${plan.globallyDisabled ? " (switched off platform-wide)" : ""}: risk is recorded, never applied.${plan.riskDecision && plan.riskDecision !== resolved.decision ? ` Its configured mapping would have suggested ${plan.riskDecision}.` : ""}`
          : plan.unavailable
            ? `Risk control is ${plan.effectiveMode} but no assessment was available, so policy stands.`
            : plan.escalated
              ? `Risk control (${plan.effectiveMode}) makes the decision ${plan.gate}, stricter than policy alone (${resolved.decision}).${plan.cappedByMode ? " A configured BLOCK was capped to REQUIRE_APPROVAL by the mode." : ""}`
              : `Risk control (${plan.effectiveMode}) adds nothing to the policy decision.`,
    },
    {
      stage: "APPROVAL",
      decisive: requiresApproval,
      summary: requiresApproval
        ? "A human must approve. A real request would open an approval request that can be used once, for this exact request, before it expires. This simulation opened none."
        : decision === "BLOCK"
          ? "BLOCK is final: no approval can lift it."
          : "No human approval is required.",
    },
  ];

  return {
    recorded: false,
    decision,
    decisionSource,
    reason,
    policyDecision: resolved.decision,
    matchingMode,
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      owner: agent.owner,
      environment: agent.environment,
      status: agent.status,
      configuredRiskLevel: agent.riskLevel,
      identity: identity.get(agent.id)!,
    },
    effective: {
      environment: matchInput.environment,
      riskLevel: matchInput.riskLevel,
      claimedEnvironmentIgnored: Boolean(claimedEnvironment),
      claimedRiskLevelRaised: Boolean(claimedRiskLevel),
    },
    matched: {
      permission: resolved.matchedPermissionSnapshot ?? null,
      policies: resolved.matchedPolicySnapshots,
      defaultDeny,
    },
    behavior: {
      baseline: riskContext?.baseline ? { version: riskContext.baseline.version, maturity: riskContext.baseline.maturity } : null,
      deviations: (riskContext?.deviations ?? []).map((d) => ({ kind: d.kind, confidence: d.confidence, explanation: d.explanation })),
    },
    trust: riskContext?.trust ? { state: riskContext.trust.state, score: riskContext.trust.score } : null,
    risk,
    riskControl: {
      configuredMode: plan.configuredMode,
      effectiveMode: plan.effectiveMode,
      globallyDisabled: plan.globallyDisabled,
      riskDecision: plan.riskDecision,
      enforceable: plan.enforceable,
      cappedByMode: plan.cappedByMode,
      escalated: plan.escalated,
      unavailable: plan.unavailable,
    },
    approval: {
      required: requiresApproval,
      wouldOpenRequest: requiresApproval,
      expiresInMs: requiresApproval ? APPROVAL_PENDING_TTL_MS : null,
      reviewerRoles: requiresApproval ? REVIEWER_ROLES : [],
      note: "Simulation never creates or consumes an approval.",
    },
    enforcement: {
      returns: decision,
      mechanism: "decision-api",
      coverage: cov,
      note:
        cov.reportedActions === 0
          ? "Aegis would return this decision. Whether the action is actually prevented depends on the integration honoring it; this agent has reported no actions in the window, so there is no evidence either way."
          : `Aegis would return this decision. Whether the action is actually prevented depends on the integration honoring it. In the last ${cov.windowDays} days ${cov.decided} of this agent's ${cov.reportedActions} reported actions carried a decision${cov.ranDespite ? `, and ${cov.ranDespite} ran although the decision was BLOCK or REQUIRE_APPROVAL` : ""}.`,
    },
    stages,
  };
}
