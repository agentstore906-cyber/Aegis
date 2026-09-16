import "server-only";

import type { ActivityStatus, Environment, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  detectActivityVolumeSpike,
  detectBlockSpike,
  detectCostSpike,
  detectCredentialExposureIndicator,
  detectDataAccessSpike,
  detectDeleteActivitySpike,
  detectExternalCommunicationSpike,
  detectFailureLoop,
  detectHighRiskBurst,
  detectNewSensitiveAction,
  detectNewToolUsage,
  detectPolicyViolationAfterTheFact,
  detectPromptInjectionIndicator,
} from "@/lib/security/detectors";
import { upsertAlertFinding } from "@/lib/security/repository";
import { getTodaySpendCentsForAgent, getTrailingDailyAverageCentsForAgent } from "@/lib/costs/queries";
import {
  getActionsInLastHourForAgent,
  getTodayEventCountForAgent,
  getTrailingDailyAverageEventCountForAgent,
  getTrailingHourlyAverageForAgent,
} from "@/lib/activity/queries";
import { DELETE_KEYWORDS } from "@/lib/security/risk-scoring";
import type { Finding } from "@/lib/security/types";
import { filterApplicablePolicies, resolveBestPermission } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { listActivePoliciesForEvaluation } from "@/lib/policies/repository";
import { checkAgentBudgets } from "@/lib/costs/budgets";

const BLOCK_SPIKE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_LOOP_WINDOW_MS = 5 * 60 * 1000;
const HIGH_RISK_BURST_WINDOW_MS = 10 * 60 * 1000;

export type SecurityDetectorTrigger = {
  organizationId: string;
  agent: { id: string; name: string };
  action: string;
  resource?: string | null;
  environment?: Environment | null;
  riskLevel: RiskLevel;
  status: ActivityStatus;
  traceId: string | null;
  /** Real tool identity, when the caller reported one — see detectNewToolUsage. */
  toolName?: string | null;
  /** Free-text reported alongside the event — scanned for prompt-injection indicators. Only present for self-reported events (POST /api/v1/events); the pre-flight /evaluate path carries no free text. */
  description?: string | null;
  /** Field names (never values) that looked secret-shaped in this event's metadata — see lib/security/redact.ts#findSecretShapedKeyPaths. */
  secretShapedKeyPaths?: string[];
  /**
   * Only set true for the post-hoc ingestion path (lib/activity/ingest.ts)
   * — re-checks the action against current policy to detect a violation
   * that already happened and couldn't be prevented (Firewall
   * truthfulness, spec §8). Never set from lib/policies/evaluate.ts, which
   * already produced its own authoritative, correctly-timed decision.
   */
  checkPolicyViolation?: boolean;
};

/**
 * Runs every activity-triggered detector inline (spec §32's "service
 * hook" model — called directly from lib/policies/evaluate.ts and
 * lib/activity/ingest.ts, no queue). Every query is scoped to a short,
 * indexed window; the exception is the new-sensitive-action /
 * new-tool-usage existence checks, which need real history — those lean
 * on the `[agentId, action]` index added alongside this feature rather
 * than scanning unindexed.
 *
 * Never throws: a detector failure must not break the activity/evaluation
 * flow it's piggybacking on. Logged and swallowed instead.
 */
export async function runSecurityDetectors(trigger: SecurityDetectorTrigger): Promise<void> {
  try {
    await runDetectorsUnsafe(trigger);
  } catch (error) {
    console.error(
      JSON.stringify({ msg: "security_detectors_failed", agentId: trigger.agent.id, error: String(error) })
    );
  }
}

async function runDetectorsUnsafe(trigger: SecurityDetectorTrigger): Promise<void> {
  const { organizationId, agent, action, resource, environment, riskLevel, status, traceId, toolName } = trigger;
  const now = Date.now();

  const [priorActionCount, priorNamespaceCount, priorToolCount, blockedCountInWindow, highRiskCountInWindow] =
    await Promise.all([
      prisma.activityEvent.count({ where: { organizationId, agentId: agent.id, action } }),
      countNamespaceHistory(organizationId, agent.id, action),
      toolName ? prisma.activityEvent.count({ where: { organizationId, agentId: agent.id, toolName } }) : Promise.resolve(0),
      prisma.activityEvent.count({
        where: {
          organizationId,
          agentId: agent.id,
          status: "BLOCKED",
          timestamp: { gte: new Date(now - BLOCK_SPIKE_WINDOW_MS) },
        },
      }),
      prisma.activityEvent.count({
        where: {
          organizationId,
          agentId: agent.id,
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          timestamp: { gte: new Date(now - HIGH_RISK_BURST_WINDOW_MS) },
        },
      }),
    ]);

  const findings: (Finding | null)[] = [
    detectNewSensitiveAction({
      agentId: agent.id,
      agentName: agent.name,
      action,
      riskLevel,
      status,
      traceId,
      hasPriorHistory: priorActionCount > 1,
    }),
    detectNewToolUsage({
      agentId: agent.id,
      agentName: agent.name,
      action,
      toolName,
      hasPriorNamespaceHistory: priorNamespaceCount > 1,
      hasPriorToolHistory: priorToolCount > 1,
    }),
    detectBlockSpike({ agentId: agent.id, agentName: agent.name, blockedCountInWindow }),
    detectHighRiskBurst({ agentId: agent.id, agentName: agent.name, highRiskCountInWindow }),
  ];

  if (trigger.description) {
    findings.push(
      detectPromptInjectionIndicator({
        agentId: agent.id,
        agentName: agent.name,
        action,
        text: trigger.description,
        traceId,
      })
    );
  }

  if (trigger.secretShapedKeyPaths && trigger.secretShapedKeyPaths.length > 0) {
    findings.push(
      detectCredentialExposureIndicator({
        agentId: agent.id,
        agentName: agent.name,
        action,
        secretShapedKeyPaths: trigger.secretShapedKeyPaths,
        traceId,
      })
    );
  }

  // Only for post-hoc event ingestion, and only when the action didn't
  // already come back BLOCKED (an agent self-reporting that it was already
  // stopped isn't a violation Aegis failed to catch).
  if (trigger.checkPolicyViolation && status !== "BLOCKED") {
    const [permissions, policies] = await Promise.all([
      prisma.agentPermission.findMany({ where: { organizationId, agentId: agent.id } }),
      listActivePoliciesForEvaluation(organizationId, agent.id),
    ]);
    const input = { organizationId, agentId: agent.id, action, resource: resource ?? undefined, environment: environment ?? undefined, riskLevel };
    const resolved = resolveDecision(resolveBestPermission(permissions, input), filterApplicablePolicies(policies, input), input);

    findings.push(
      detectPolicyViolationAfterTheFact({
        agentId: agent.id,
        agentName: agent.name,
        action,
        resource,
        policyDecision: resolved.decision,
        policyName: resolved.winningPolicySnapshot?.name,
        reason: resolved.reason,
        traceId,
      })
    );
  }

  if (status === "FAILED") {
    const failureCountInWindow = await prisma.activityEvent.count({
      where: {
        organizationId,
        agentId: agent.id,
        action,
        status: "FAILED",
        timestamp: { gte: new Date(now - FAILURE_LOOP_WINDOW_MS) },
      },
    });
    findings.push(
      detectFailureLoop({ agentId: agent.id, agentName: agent.name, action, failureCountInWindow, traceId })
    );
  }

  for (const finding of findings) {
    if (finding) await upsertAlertFinding(organizationId, finding);
  }

  // Two indexed, week-scoped aggregate SUMs — cheap enough to run inline
  // on every event. upsertAlertFinding's 24h dedup window (not a separate
  // throttle here) is what actually keeps this from spamming alerts.
  const [todaySpendCents, trailingDailyAverageCents] = await Promise.all([
    getTodaySpendCentsForAgent(organizationId, agent.id),
    getTrailingDailyAverageCentsForAgent(organizationId, agent.id),
  ]);
  const costFinding = detectCostSpike({ agentId: agent.id, agentName: agent.name, todaySpendCents, trailingDailyAverageCents });
  if (costFinding) await upsertAlertFinding(organizationId, costFinding);

  // Agent-scoped budget check (Phase 6) — returns immediately if this agent has no budgets configured.
  await checkAgentBudgets(organizationId, agent);

  const [actionsThisHour, trailingHourlyAverage] = await Promise.all([
    getActionsInLastHourForAgent(organizationId, agent.id),
    getTrailingHourlyAverageForAgent(organizationId, agent.id),
  ]);
  const volumeFinding = detectActivityVolumeSpike({
    agentId: agent.id,
    agentName: agent.name,
    actionsThisHour,
    trailingHourlyAverage,
  });
  if (volumeFinding) await upsertAlertFinding(organizationId, volumeFinding);

  // Data access / delete activity / external communication spikes (Phase
  // 2) — same "two cheap indexed-window aggregates per event" shape as
  // cost/volume spike above; the 24h dedup window in upsertAlertFinding is
  // what actually keeps this from spamming alerts, not any throttle here.
  const deleteKeywordFilter = {
    OR: DELETE_KEYWORDS.flatMap((keyword) => [
      { action: { contains: keyword, mode: "insensitive" as const } },
      { resource: { contains: keyword, mode: "insensitive" as const } },
    ]),
  };

  const [
    todayDataAccess,
    trailingDataAccess,
    todayDeletes,
    trailingDeletes,
    todayCommunications,
    trailingCommunications,
  ] = await Promise.all([
    getTodayEventCountForAgent(organizationId, agent.id, { eventType: "DATA_ACCESS" }),
    getTrailingDailyAverageEventCountForAgent(organizationId, agent.id, { eventType: "DATA_ACCESS" }),
    getTodayEventCountForAgent(organizationId, agent.id, deleteKeywordFilter),
    getTrailingDailyAverageEventCountForAgent(organizationId, agent.id, deleteKeywordFilter),
    getTodayEventCountForAgent(organizationId, agent.id, { eventType: "COMMUNICATION" }),
    getTrailingDailyAverageEventCountForAgent(organizationId, agent.id, { eventType: "COMMUNICATION" }),
  ]);

  const dataAccessFinding = detectDataAccessSpike({
    agentId: agent.id,
    agentName: agent.name,
    todayCount: todayDataAccess,
    trailingDailyAverage: trailingDataAccess,
  });
  if (dataAccessFinding) await upsertAlertFinding(organizationId, dataAccessFinding);

  const deleteFinding = detectDeleteActivitySpike({
    agentId: agent.id,
    agentName: agent.name,
    todayCount: todayDeletes,
    trailingDailyAverage: trailingDeletes,
  });
  if (deleteFinding) await upsertAlertFinding(organizationId, deleteFinding);

  const communicationFinding = detectExternalCommunicationSpike({
    agentId: agent.id,
    agentName: agent.name,
    todayCount: todayCommunications,
    trailingDailyAverage: trailingCommunications,
  });
  if (communicationFinding) await upsertAlertFinding(organizationId, communicationFinding);
}

async function countNamespaceHistory(organizationId: string, agentId: string, action: string): Promise<number> {
  const dotIndex = action.indexOf(".");
  const namespace = dotIndex === -1 ? action : action.slice(0, dotIndex);

  return prisma.activityEvent.count({
    where: {
      organizationId,
      agentId,
      action: dotIndex === -1 ? namespace : { startsWith: `${namespace}.` },
    },
  });
}
