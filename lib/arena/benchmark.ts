import "server-only";

import type { PolicyDecision } from "@prisma/client";

import { prisma } from "@/lib/db";
import { filterApplicablePolicies, resolveBestPermission } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { listActivePoliciesForEvaluation } from "@/lib/policies/repository";
import type { PolicyEvaluationInput } from "@/lib/policies/types";
import { ARENA_SCENARIOS } from "@/lib/arena/scenarios";
import { computeCategoryScores, computeOverallScore, scoreScenario } from "@/lib/arena/scoring";
import type {
  ArenaScoreResult,
  ArenaTelemetrySummary,
  ScenarioOutcome,
} from "@/lib/arena/types";

const TELEMETRY_EVENT_LIMIT = 1000;

/**
 * Runs the Agent Arena benchmark for one connected agent and returns a real,
 * deterministic 0–1000 score.
 *
 * Two independent, side-effect-free signals feed the score:
 *
 *  1. A fixed probe suite (lib/arena/scenarios.ts) evaluated against the
 *     agent's actual Aegis configuration — its permissions and active
 *     policies — using the *pure* resolver functions. This never calls
 *     evaluateAgentAction(), so it writes no ActivityEvent/PolicyEvaluation,
 *     creates no ApprovalRequest, fires no webhook, and runs no security
 *     detector. Dangerous "tools" are just strings.
 *
 *  2. The agent's already-observed telemetry (ActivityEvent, SecurityAlert)
 *     — reliability, task performance, cost, latency, and unresolved
 *     high/critical alerts.
 *
 * Nothing here sends email, mutates a CRM, moves money, touches production,
 * or exposes a secret. It is read-only over the agent's own org-scoped data.
 */
export async function runArenaBenchmark(
  organizationId: string,
  agentId: string
): Promise<ArenaScoreResult> {
  const [permissions, policies, telemetry] = await Promise.all([
    prisma.agentPermission.findMany({ where: { organizationId, agentId } }),
    listActivePoliciesForEvaluation(organizationId, agentId),
    gatherTelemetry(organizationId, agentId),
  ]);

  const outcomes: ScenarioOutcome[] = ARENA_SCENARIOS.map((scenario) => {
    const input: PolicyEvaluationInput = {
      organizationId,
      agentId,
      action: scenario.action,
      resource: scenario.resource,
      environment: scenario.environment,
      tool: scenario.tool,
      riskLevel: scenario.riskLevel,
      context: scenario.context,
    };

    const decision: PolicyDecision = resolveDecision(
      resolveBestPermission(permissions, input),
      filterApplicablePolicies(policies, input),
      input
    ).decision;

    return scoreScenario(scenario, decision);
  });

  const { scores, lowConfidence } = computeCategoryScores(outcomes, telemetry);
  const overallScore = computeOverallScore(scores);

  const scenariosPassed = outcomes.filter((o) => o.passed).length;

  return {
    overallScore,
    categoryScores: scores,
    scenarioOutcomes: outcomes,
    metrics: {
      scenariosRun: outcomes.length,
      scenariosPassed,
      telemetryEventsAnalyzed: telemetry.totalEvents,
      telemetryTasksAnalyzed: telemetry.taskCount,
      hasTelemetry: telemetry.totalEvents > 0,
      lowConfidenceCategories: lowConfidence,
    },
  };
}

async function gatherTelemetry(
  organizationId: string,
  agentId: string
): Promise<ArenaTelemetrySummary> {
  const [events, openAlerts] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { organizationId, agentId },
      orderBy: { timestamp: "desc" },
      take: TELEMETRY_EVENT_LIMIT,
      select: {
        status: true,
        durationMs: true,
        costCents: true,
        taskId: true,
      },
    }),
    prisma.securityAlert.count({
      where: {
        organizationId,
        agentId,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        severity: { in: ["HIGH", "CRITICAL"] },
      },
    }),
  ]);

  const totalEvents = events.length;
  let failedEvents = 0;
  let blockedEvents = 0;
  let approvalRequiredEvents = 0;
  let allowedEvents = 0;

  const durations: number[] = [];
  const costs: number[] = [];

  const taskStatus = new Map<string, { anySuccess: boolean; anyFailure: boolean }>();

  for (const e of events) {
    if (e.status === "FAILED") failedEvents += 1;
    else if (e.status === "BLOCKED") blockedEvents += 1;
    else if (e.status === "APPROVAL_REQUIRED") approvalRequiredEvents += 1;
    else allowedEvents += 1;

    if (typeof e.durationMs === "number") durations.push(e.durationMs);
    if (typeof e.costCents === "number") costs.push(e.costCents);

    if (e.taskId) {
      const t = taskStatus.get(e.taskId) ?? { anySuccess: false, anyFailure: false };
      if (e.status === "ALLOWED") t.anySuccess = true;
      if (e.status === "FAILED" || e.status === "BLOCKED") t.anyFailure = true;
      taskStatus.set(e.taskId, t);
    }
  }

  let successfulTaskCount = 0;
  for (const t of taskStatus.values()) {
    if (t.anySuccess && !t.anyFailure) successfulTaskCount += 1;
  }

  return {
    totalEvents,
    failedEvents,
    blockedEvents,
    approvalRequiredEvents,
    allowedEvents,
    openHighOrCriticalAlerts: openAlerts,
    avgDurationMs: average(durations),
    p50DurationMs: percentile(durations, 0.5),
    avgCostCents: average(costs),
    taskCount: taskStatus.size,
    successfulTaskCount,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
