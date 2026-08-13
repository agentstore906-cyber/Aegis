import "server-only";

import type { ActivityStatus, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  detectBlockSpike,
  detectCostSpike,
  detectFailureLoop,
  detectHighRiskBurst,
  detectNewSensitiveAction,
  detectNewToolUsage,
} from "@/lib/security/detectors";
import { upsertAlertFinding } from "@/lib/security/repository";
import { getTodaySpendCentsForAgent, getTrailingDailyAverageCentsForAgent } from "@/lib/costs/queries";
import type { Finding } from "@/lib/security/types";

const BLOCK_SPIKE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_LOOP_WINDOW_MS = 5 * 60 * 1000;
const HIGH_RISK_BURST_WINDOW_MS = 10 * 60 * 1000;

export type SecurityDetectorTrigger = {
  organizationId: string;
  agent: { id: string; name: string };
  action: string;
  riskLevel: RiskLevel;
  status: ActivityStatus;
  traceId: string | null;
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
  const { organizationId, agent, action, riskLevel, status, traceId } = trigger;
  const now = Date.now();

  const [priorActionCount, priorNamespaceCount, blockedCountInWindow, highRiskCountInWindow] = await Promise.all([
    prisma.activityEvent.count({ where: { organizationId, agentId: agent.id, action } }),
    countNamespaceHistory(organizationId, agent.id, action),
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
    detectNewToolUsage({ agentId: agent.id, agentName: agent.name, action, hasPriorNamespaceHistory: priorNamespaceCount > 1 }),
    detectBlockSpike({ agentId: agent.id, agentName: agent.name, blockedCountInWindow }),
    detectHighRiskBurst({ agentId: agent.id, agentName: agent.name, highRiskCountInWindow }),
  ];

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
