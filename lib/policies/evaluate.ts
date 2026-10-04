import "server-only";

import { randomUUID } from "node:crypto";
import type { ActivityStatus, PolicyDecision, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { filterApplicablePolicies, resolveBestPermission, type MatchingMode } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { listActivePoliciesForEvaluation } from "@/lib/policies/repository";
import { buildDecisionContext, isAgentHalted } from "@/lib/policies/decision-context";
import type { DecisionSource, PolicyEvaluationInput, PolicyEvaluationResult } from "@/lib/policies/types";
import { createApprovalRequestForEvaluation, expirePendingApproval } from "@/lib/approvals/repository";
import {
  APPROVAL_PENDING_TTL_MS,
  checkApprovalConsumable,
  computeRequestFingerprint,
  type ApprovalDenialCode,
} from "@/lib/approvals/binding";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { runSecurityDetectors } from "@/lib/security/evaluate";
import { upsertAlertFinding } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { redactSecretValues, redactSecrets } from "@/lib/security/redact";
import { scoreEventRisk } from "@/lib/security/risk-scoring";
import { normalizeKey, sensitivityForDataClasses } from "@/lib/telemetry/normalize";
import { pseudonymizeEndUser } from "@/lib/telemetry/pseudonymize";
import { resolveLineage } from "@/lib/telemetry/lineage";
import { buildRiskSignals } from "@/lib/telemetry/signals";
import { trackEvent } from "@/lib/analytics/track";
import { defer } from "@/lib/server/defer";
import { observeEventBehavior } from "@/lib/behavior/observe";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { buildShadow, composeRisk, finalizeAssessment } from "@/lib/risk/compose";
import {
  controlOutcome,
  isRiskControlGloballyDisabled,
  planRiskControl,
  riskGateReason,
  type RiskControlConfig,
} from "@/lib/risk/control";
import { buildControlRecord } from "@/lib/risk/record";
import { startRiskContext } from "@/lib/risk/context";
import type { RiskInputs } from "@/lib/risk/types";

/** Composition is pure, but a bug in advisory code must never fail a decision. */
function safeComposeRisk(inputs: RiskInputs) {
  try {
    return composeRisk(inputs);
  } catch (error) {
    console.error(JSON.stringify({ msg: "risk_compose_failed", error: String(error) }));
    return null;
  }
}

// ALERT maps to WARNING, not ALLOWED — same "succeeded, but flagged" status
// risk scoring/detectors use, so the activity feed doesn't pretend a
// deliberately-configured ALERT policy is indistinguishable from a plain
// ALLOW. Never BLOCKED: nothing here actually stops the action.
const DECISION_TO_ACTIVITY_STATUS: Record<PolicyDecision, ActivityStatus> = {
  ALLOW: "ALLOWED",
  REQUIRE_APPROVAL: "APPROVAL_REQUIRED",
  BLOCK: "BLOCKED",
  ALERT: "WARNING",
};

/** What the approval step decided before the transaction runs. */
type ApprovalPlan =
  | { kind: "none" }
  | { kind: "consume"; approvalRequestId: string }
  | { kind: "still_pending"; approvalRequestId: string; expiresAt: Date | null }
  | { kind: "denied"; approvalRequestId: string; code: ApprovalDenialCode; reason: string };

/**
 * The single entry point for authorization decisions. Framework-independent
 * (no Next.js request/response types) so Server Actions, the public API,
 * and tests all call the same function.
 *
 * Pipeline (P0 — docs/AEGIS_P0_IMPLEMENTATION.md):
 *   1. Trusted context  server-side environment + risk floor
 *                       (decision-context.ts) — caller can't under-declare
 *   2. Policy           permissions + policies, fail-closed on unknown fields
 *   3. Kill switch      a STOPPED / PAUSED / ARCHIVED agent is never ALLOWed
 *   4. Approval         a REQUIRE_APPROVAL request can be satisfied only by
 *                       consuming a matching, unexpired, unused APPROVED
 *                       approval — atomically, exactly once
 *   5. Record           ActivityEvent + PolicyEvaluation (+ ApprovalRequest),
 *                       one transaction
 *   6. After response   webhooks, detectors (lib/server/defer.ts) — never on
 *                       the decision path, never able to fail it
 *
 * Never swallows errors into a silent ALLOW — if evaluation cannot
 * complete, it throws.
 */
export async function evaluateAgentAction(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
  const startedAt = Date.now();
  const now = new Date();

  const agent = await prisma.agent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
    include: { organization: { select: { legacyPolicyMatching: true, riskControlMode: true, riskMediumAction: true, riskHighAction: true } } },
  });
  if (!agent) {
    throw new Error("Agent not found in this organization — refusing to evaluate.");
  }

  // Lineage first: a bad parent reference is a caller error (400) and must
  // not leave a half-recorded decision behind.
  const telemetry = input.telemetry ?? {};
  const lineage = await resolveLineage({
    organizationId: input.organizationId,
    agentId: input.agentId,
    apiKeyAgentId: input.apiKeyAgentId ?? null,
    parentEventId: telemetry.parentEventId,
    parentClientEventId: telemetry.parentClientEventId,
    traceId: input.traceId,
  });
  const traceId = lineage.traceId ?? randomUUID();
  const matchingMode: MatchingMode = agent.organization.legacyPolicyMatching ? "LEGACY" : "STRICT";
  const { matchInput, claimedEnvironment, claimedRiskLevel } = buildDecisionContext(input, agent, matchingMode);

  // P4 (shadow): start loading risk evidence now so it overlaps the policy
  // queries below. Never rejects — see startRiskContext.
  const evaluatedAt = new Date();
  const eventTypeForRisk = input.eventType ?? "ACTION";
  const endUserHashForRisk = telemetry.endUserId ? pseudonymizeEndUser(input.organizationId, telemetry.endUserId) : null;
  const riskContextPromise = startRiskContext({
    organizationId: input.organizationId,
    agentId: input.agentId,
    action: input.action,
    eventType: eventTypeForRisk,
    toolKey: normalizeKey(input.tool),
    service: telemetry.service ?? null,
    destination: telemetry.destination?.destination ?? null,
    dataClasses: telemetry.dataClasses ?? [],
    endUserHash: endUserHashForRisk,
    recordCount: telemetry.recordCount ?? null,
    byteCount: telemetry.byteCount ?? null,
    parentEventId: lineage.parentEventId,
    now: evaluatedAt,
  });

  const [permissions, candidatePolicies] = await Promise.all([
    prisma.agentPermission.findMany({ where: { organizationId: input.organizationId, agentId: input.agentId } }),
    listActivePoliciesForEvaluation(input.organizationId, input.agentId),
  ]);

  const permission = resolveBestPermission(permissions, matchInput, matchingMode);
  const matchedPolicies = filterApplicablePolicies(candidatePolicies, matchInput, matchingMode);
  const resolved = resolveDecision(permission, matchedPolicies, matchInput);

  // Caller-supplied context may carry secret-shaped keys — redact once here
  // so every downstream write persists the same safe copy.
  // P1: plus value-based redaction of recognizable credential formats.
  const contextRedaction = redactSecretValues(
    input.context && Object.keys(input.context).length > 0 ? redactSecrets(input.context) : undefined
  );
  const safeContext = contextRedaction.value;
  const endUserHash = endUserHashForRisk ?? undefined;
  const dataClasses = telemetry.dataClasses ?? [];
  const dataSensitivity = sensitivityForDataClasses(dataClasses, telemetry.dataSensitivity);

  const fingerprint = computeRequestFingerprint({
    agentId: input.agentId,
    action: input.action,
    resource: input.resource,
    environment: matchInput.environment,
    tool: input.tool,
    context: safeContext,
    telemetry: {
      service: telemetry.service,
      destination: telemetry.destination?.destination,
      dataClasses,
      recordCount: telemetry.recordCount,
      byteCount: telemetry.byteCount,
      endUserHash,
    },
  });

  const scored = scoreEventRisk({
    eventType: input.eventType ?? "ACTION",
    action: input.action,
    resource: input.resource,
    status: "SUCCESS",
  });

  // Risk assessment (P4) and risk-driven control (P5). Assessment is pure from
  // here on. What it may DO is decided by the organization's configuration
  // (default OBSERVE = nothing) and can only ever make the decision stricter
  // than policy alone — see lib/risk/control.ts for the precedence model.
  const riskContext = await riskContextPromise;
  const riskCore = riskContext
    ? safeComposeRisk({
        action: input.action,
        policy: {
          policyDecision: resolved.decision,
          explicitRuleMatched: Boolean(permission) || matchedPolicies.length > 0,
          winningPolicy: resolved.winningPolicySnapshot,
          matchedPermission: resolved.matchedPermissionSnapshot,
        },
        request: { scoredRule: scored.rule, scoredLevel: scored.level, dataSensitivity, dataClasses },
        ...riskContext,
        now: evaluatedAt,
      })
    : null;
  const riskConfig: RiskControlConfig = {
    mode: agent.organization.riskControlMode,
    mediumAction: agent.organization.riskMediumAction,
    highAction: agent.organization.riskHighAction,
  };
  const plan = planRiskControl({
    config: riskConfig,
    globallyDisabled: isRiskControlGloballyDisabled(),
    level: riskCore?.level ?? null,
    policyDecision: resolved.decision,
  });
  if (plan.unavailable) {
    // Enforcement is on but there is no assessment: policy stands (documented fail-open), loudly.
    console.error(JSON.stringify({ msg: "risk_control_unavailable", organizationId: input.organizationId, agentId: input.agentId }));
  }
  const riskGated = plan.escalated && riskCore !== null;

  let decision: PolicyDecision = plan.gate;
  let reason = riskGated
    ? riskGateReason({ plan, level: riskCore.level, policyDecision: resolved.decision, policyReason: resolved.reason })
    : resolved.reason;
  let decisionSource: DecisionSource = riskGated ? "RISK" : permission || matchedPolicies.length > 0 ? "POLICY" : "DEFAULT_DENY";
  const gateReason = reason;
  const halted = isAgentHalted(agent.status);

  // --- Kill switch -------------------------------------------------------
  if (halted) {
    decision = "BLOCK";
    decisionSource = "CONTROL";
    reason =
      `Blocked because agent "${agent.name}" is ${agent.status} — Aegis refuses every authorization request from a ` +
      `${agent.status.toLowerCase()} agent until an operator resumes it. ` +
      `(Policy alone would have returned ${resolved.decision}: ${resolved.reason})`;
  }

  // --- Approval consumption ----------------------------------------------
  let approvalPlan: ApprovalPlan = { kind: "none" };
  // Eligible when the request is gated (by policy or by risk) and policy itself did not say BLOCK: an explicit
  // or default-deny BLOCK is final and cannot be approved around; a risk gate can be lifted by a human.
  if (!halted && input.approvalRequestId && resolved.decision !== "BLOCK" && (plan.gate === "REQUIRE_APPROVAL" || plan.gate === "BLOCK")) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: input.approvalRequestId, organizationId: input.organizationId },
      select: {
        id: true,
        agentId: true,
        status: true,
        expiresAt: true,
        requestFingerprint: true,
        executionExpiresAt: true,
        consumedAt: true,
      },
    });
    const check = checkApprovalConsumable(approval, input.agentId, fingerprint, now);
    if (check.ok) {
      approvalPlan = { kind: "consume", approvalRequestId: input.approvalRequestId };
    } else if (check.outcome === "PENDING") {
      // Only meaningful while the gate is an approval gate; a risk BLOCK stands until the approval is granted.
      if (plan.gate === "REQUIRE_APPROVAL") {
        approvalPlan = {
          kind: "still_pending",
          approvalRequestId: input.approvalRequestId,
          expiresAt: approval?.expiresAt ?? null,
        };
        reason = `Approval required: approval request ${input.approvalRequestId} for this exact request is still pending a human decision. ${gateReason}`;
      }
    } else {
      if (check.code === "APPROVAL_EXPIRED" && approval?.status === "PENDING") {
        await expirePendingApproval(approval.id);
      }
      approvalPlan = { kind: "denied", approvalRequestId: input.approvalRequestId, code: check.code, reason: check.reason };
      decision = "BLOCK";
      decisionSource = "APPROVAL";
      reason = `Blocked because ${check.reason}. ${gateReason}`;
    }
  }

  const durationMs = Date.now() - startedAt;
  const effectiveRiskLevel = matchInput.riskLevel ?? agent.riskLevel;
  const riskSignals = buildRiskSignals({
    scoredRule: scored.rule,
    scoredLevel: scored.level,
    agentRiskLevel: agent.riskLevel,
    claimedRiskLevel,
    effectiveRiskLevel: matchInput.riskLevel,
    claimedEnvironment,
    effectiveEnvironment: matchInput.environment,
    dataClasses,
    dataSensitivity,
    secretShapedFieldCount: 0,
    secretValueRedactions: { count: contextRedaction.redactedCount, kinds: contextRedaction.kinds },
  });

  const outcome = await prisma.$transaction(async (tx) => {
    let consumedApprovalRequestId: string | undefined;
    let approvalDenialCode: string | undefined = approvalPlan.kind === "denied" ? approvalPlan.code : undefined;

    if (approvalPlan.kind === "consume") {
      // Atomic single-use claim. Under concurrent consumers Postgres row
      // locking makes the second UPDATE re-check `consumedAt IS NULL` after
      // the first commits — exactly one wins; the rest get BLOCK below.
      const claimed = await tx.approvalRequest.updateMany({
        where: {
          id: approvalPlan.approvalRequestId,
          organizationId: input.organizationId,
          agentId: input.agentId,
          status: "APPROVED",
          consumedAt: null,
          requestFingerprint: fingerprint,
          executionExpiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (claimed.count === 1) {
        consumedApprovalRequestId = approvalPlan.approvalRequestId;
        decision = "ALLOW";
        decisionSource = "APPROVAL";
        reason =
          `Allowed because a human approved this exact request (approval ${approvalPlan.approvalRequestId}). ` +
          `The approval is single-use and has now been consumed. ${gateReason}`;
      } else {
        approvalDenialCode = "APPROVAL_ALREADY_USED";
        decision = "BLOCK";
        decisionSource = "APPROVAL";
        reason = `Blocked because the referenced approval has already been used for an execution and is single-use. ${gateReason}`;
      }
    }

    const activityEvent = await tx.activityEvent.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        eventType: input.eventType ?? "ACTION",
        action: input.action,
        resource: input.resource,
        toolName: input.tool,
        toolKey: normalizeKey(input.tool),
        status: DECISION_TO_ACTIVITY_STATUS[decision],
        riskLevel: effectiveRiskLevel,
        source: "policy_evaluation",
        durationMs,
        traceId,
        metadata: safeContext,
        // P1 — the decision row's structured context. No `outcome`: nothing
        // has executed yet; the agent's reported execution (POST /events with
        // evaluationId) carries the result and links back here.
        parentEventId: lineage.parentEventId,
        parentClientEventId: lineage.parentClientEventId,
        environment: matchInput.environment ?? agent.environment,
        service: telemetry.service,
        destination: telemetry.destination?.destination,
        destinationKind: telemetry.destination?.kind,
        endUserHash,
        dataClasses,
        dataSensitivity,
        recordCount: telemetry.recordCount,
        byteCount: telemetry.byteCount,
        riskSignals: riskSignals.length > 0 ? (riskSignals as Prisma.InputJsonValue) : undefined,
      },
    });

    // The FINAL decision is known here. "Actual" is what Aegis returned; "recommended" is what the
    // organization's configured risk mapping would have decided, never weaker than actual.
    const riskAssessment = riskCore
      ? finalizeAssessment(
          riskCore,
          buildShadow({
            level: riskCore.level,
            actual: decision,
            humanApproved: decisionSource === "APPROVAL" && decision === "ALLOW",
            riskDecision: plan.riskDecision ?? undefined,
          })
        )
      : null;
    const controlResult = controlOutcome({ plan, halted, finalDecision: decision, finalSource: decisionSource });
    const riskControl = buildControlRecord({
      plan,
      config: riskConfig,
      outcome: controlResult,
      policyDecision: resolved.decision,
      finalDecision: decision,
      finalSource: decisionSource,
      assessment: riskAssessment,
      decidedAt: now,
      traceId,
    });

    const evaluation = await tx.policyEvaluation.create({
      data: {
        riskAssessment: riskAssessment ? (riskAssessment as unknown as Prisma.InputJsonValue) : undefined,
        riskAssessedLevel: riskAssessment?.level,
        riskRecommendedDecision: riskAssessment?.shadow.recommended,
        riskShadowOutcome: riskAssessment?.shadow.outcome,
        policyDecision: resolved.decision,
        riskControlMode: plan.effectiveMode,
        riskControlOutcome: controlResult,
        riskControl: riskControl as unknown as Prisma.InputJsonValue,
        organizationId: input.organizationId,
        agentId: input.agentId,
        action: input.action,
        resource: input.resource,
        environment: matchInput.environment,
        tool: input.tool,
        riskLevel: matchInput.riskLevel,
        context: safeContext,
        decision,
        reason,
        permissionId: resolved.matchedPermissionSnapshot?.id,
        permissionSnapshot: resolved.matchedPermissionSnapshot,
        matchedPolicyIds: resolved.matchedPolicySnapshots.map((p) => p.id),
        matchedPolicySnapshots: resolved.matchedPolicySnapshots,
        traceId,
        activityEventId: activityEvent.id,
        decisionSource,
        agentStatus: agent.status,
        matchingMode,
        claimedEnvironment,
        claimedRiskLevel,
        consumedApprovalRequestId,
      },
    });

    // Every risk-driven change to a decision is an audit event, in the same transaction as the decision.
    if (controlResult === "ESCALATED" || controlResult === "APPROVAL_HONORED") {
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "SYSTEM",
        agentId: input.agentId,
        eventType: AUDIT_EVENT_TYPES.RISK_CONTROL_ENFORCED,
        entityType: "PolicyEvaluation",
        entityId: evaluation.id,
        action: input.action,
        metadata: {
          outcome: controlResult,
          mode: plan.effectiveMode,
          riskLevel: riskAssessment?.level ?? null,
          policyDecision: resolved.decision,
          riskGate: plan.gate,
          finalDecision: decision,
        },
        traceId,
      });
    }

    let approvalRequestId: string | undefined;
    let approvalExpiresAt: Date | undefined;

    if (consumedApprovalRequestId) {
      await tx.approvalRequest.update({
        where: { id: consumedApprovalRequestId },
        data: { consumedByEvaluationId: evaluation.id },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "AGENT",
        agentId: input.agentId,
        eventType: AUDIT_EVENT_TYPES.APPROVAL_CONSUMED,
        entityType: "ApprovalRequest",
        entityId: consumedApprovalRequestId,
        action: input.action,
        metadata: { evaluationId: evaluation.id },
        traceId,
      });
    } else if (approvalPlan.kind === "denied" || approvalDenialCode) {
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "AGENT",
        agentId: input.agentId,
        eventType: AUDIT_EVENT_TYPES.APPROVAL_CONSUMPTION_DENIED,
        entityType: "ApprovalRequest",
        entityId: input.approvalRequestId ?? "unknown",
        action: input.action,
        result: "FAILURE",
        metadata: { evaluationId: evaluation.id, code: approvalDenialCode },
        traceId,
      });
    }

    if (decision === "REQUIRE_APPROVAL" && approvalPlan.kind === "still_pending") {
      // Re-asked while a matching request is already open: point at it, don't open a duplicate.
      approvalRequestId = approvalPlan.approvalRequestId;
      approvalExpiresAt = approvalPlan.expiresAt ?? undefined;
    } else if (decision === "REQUIRE_APPROVAL") {
      approvalExpiresAt = new Date(now.getTime() + APPROVAL_PENDING_TTL_MS);
      const approval = await createApprovalRequestForEvaluation(tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        policyEvaluationId: evaluation.id,
        action: input.action,
        resource: input.resource,
        environment: matchInput.environment,
        tool: input.tool,
        riskLevel: effectiveRiskLevel,
        context: safeContext,
        reason,
        traceId,
        expiresAt: approvalExpiresAt,
        requestFingerprint: fingerprint,
      });
      approvalRequestId = approval.id;

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "SYSTEM",
        agentId: input.agentId,
        eventType: AUDIT_EVENT_TYPES.APPROVAL_REQUESTED,
        entityType: "ApprovalRequest",
        entityId: approval.id,
        action: input.action,
        metadata: { reason, expiresAt: approvalExpiresAt.toISOString() },
        traceId,
      });
    }

    return { evaluation, riskAssessment, approvalRequestId, approvalExpiresAt, consumedApprovalRequestId, approvalDenialCode, created: approvalPlan.kind !== "still_pending" };
  });

  const { evaluation, approvalRequestId } = outcome;

  // Everything below is a side effect of a decision that is already
  // committed. None of it may throw (a throw here would turn a recorded
  // decision into a 5xx that a client retries into a duplicate).
  if (approvalRequestId && outcome.created) {
    trackEvent("approval_created", { organizationId: input.organizationId, agentId: input.agentId });
    await dispatchWebhookEvent(input.organizationId, "approval.requested", {
      approvalRequestId,
      agentId: input.agentId,
      action: input.action,
      evaluationId: evaluation.id,
      traceId,
    });
  }

  // ALERT: the action proceeds; this records the detected violation as an
  // ordinary SecurityAlert. Kept synchronous (it's evidence, and alertId is
  // part of the result) but failure-isolated.
  let alertId: string | undefined;
  if (decision === "ALERT") {
    // A risk-driven ALERT is its own alert type: it is not a configured policy rule and must stay distinguishable.
    const byRisk = decisionSource === "RISK";
    const winner = byRisk ? undefined : resolved.winningPolicySnapshot;
    const riskLevelAssessed = outcome.riskAssessment?.level;
    try {
      const { alert } = await upsertAlertFinding(input.organizationId, {
        type: byRisk ? SECURITY_ALERT_TYPES.RISK_ALERT : SECURITY_ALERT_TYPES.POLICY_ALERT,
        severity: byRisk ? (riskLevelAssessed === "CRITICAL" ? "CRITICAL" : riskLevelAssessed === "HIGH" ? "HIGH" : "MEDIUM") : (winner?.severity ?? "MEDIUM"),
        agentId: input.agentId,
        title: byRisk ? `Risk alert: ${input.action}` : winner ? `Policy alert: ${winner.name}` : `Policy alert: ${input.action}`,
        description: reason,
        evidence: {
          action: input.action,
          resource: input.resource ?? null,
          environment: matchInput.environment ?? null,
          tool: input.tool ?? null,
          riskLevel: matchInput.riskLevel ?? null,
          context: safeContext ?? null,
          evaluationId: evaluation.id,
          ...(byRisk && outcome.riskAssessment
            ? { riskLevel: outcome.riskAssessment.level, headline: outcome.riskAssessment.headline, reasons: outcome.riskAssessment.reasons.map((r) => r.summary) }
            : {}),
        },
        traceId,
        dedupeKey: byRisk ? `risk:${input.action}` : winner ? `policy:${winner.id}` : `action:${input.action}`,
      });
      alertId = alert.id;
    } catch (error) {
      console.error(
        JSON.stringify({ msg: "policy_alert_record_failed", evaluationId: evaluation.id, error: String(error) })
      );
    }
  }

  // Behavioral memory (P2): attempts are compared with the agent's baseline
  // too (a first-ever destination is notable even if it was blocked); only
  // executed/allowed activity ever teaches the baseline.
  if (evaluation.activityEventId) {
    const activityEventId = evaluation.activityEventId;
    defer("behavior:evaluate", async () => {
      const deviations = await observeEventBehavior(input.organizationId, input.agentId, activityEventId);
      // Trust (P3): re-evaluate when this decision or its deviations are evidence. Kill-switch refusals aren't agent behavior.
      // The system's own risk gates are not agent misbehavior (and would feed back into risk): excluded like the kill switch.
      const byPolicy = decisionSource !== "CONTROL" && decisionSource !== "RISK";
      const adverse = (decision === "BLOCK" && byPolicy) || (decision === "ALERT" && byPolicy);
      if (adverse || deviations.length > 0) {
        await evaluateTrust(input.organizationId, input.agentId, {
          trigger: "POLICY_EVALUATION",
          triggerRef: evaluation.id,
        });
      }
    });
  }

  defer("security-detectors:evaluate", () =>
    runSecurityDetectors({
      organizationId: input.organizationId,
      agent: { id: agent.id, name: agent.name },
      action: input.action,
      riskLevel: effectiveRiskLevel,
      status: DECISION_TO_ACTIVITY_STATUS[decision],
      traceId,
    })
  );

  return {
    decision,
    reason,
    matchedPolicyIds: resolved.matchedPolicySnapshots.map((p) => p.id),
    matchedPolicySnapshots: resolved.matchedPolicySnapshots,
    matchedPermissionId: resolved.matchedPermissionSnapshot?.id,
    matchedPermissionSnapshot: resolved.matchedPermissionSnapshot,
    evaluationId: evaluation.id,
    approvalRequestId,
    alertId,
    traceId,
    decisionSource,
    agentStatus: agent.status,
    policyDecision: resolved.decision,
    matchingMode,
    effectiveEnvironment: matchInput.environment,
    effectiveRiskLevel: matchInput.riskLevel,
    approvalExpiresAt: outcome.approvalExpiresAt,
    consumedApprovalRequestId: outcome.consumedApprovalRequestId,
    approvalDenialCode: outcome.approvalDenialCode,
    riskAssessment: outcome.riskAssessment ?? undefined,
  };
}
