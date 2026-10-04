import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Enforcement coverage — the evidence for whether Aegis is actually in the
 * loop for an agent, computed only from stored events.
 *
 * Aegis does not sit in the agent's data path (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §4):
 * it returns decisions and the integration chooses to honor them. So the
 * honest question is not "is there a policy?" but "what share of what the
 * agent reported doing went through a decision, and did anything run in the
 * face of a refusal?"
 *
 * Definitions, over the window:
 *   reportedActions   events the agent REPORTED (source "api") that are actions with effects —
 *                     everything except SYSTEM (lifecycle/error chatter) and MODEL_CALL
 *   decided           of those, how many name an /evaluate decision (`evaluationId`)
 *   undecided         reportedActions − decided: actions Aegis never got to decide on
 *   ranDespite        decided executions reported as completed (SUCCESS/WARNING) under a
 *                     BLOCK or REQUIRE_APPROVAL decision — an observed fact, not an accusation
 *   decisionRequests  /evaluate decisions the agent asked for (source "policy_evaluation")
 *
 * `coverage` is decided / reportedActions, or null when nothing was reported
 * (no evidence either way — never 0% and never 100%).
 */

export type EnforcementCoverage = {
  windowDays: number;
  reportedActions: number;
  decided: number;
  undecided: number;
  ranDespite: number;
  decisionRequests: number;
  coverage: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyCoverage(windowDays: number): EnforcementCoverage {
  return { windowDays, reportedActions: 0, decided: 0, undecided: 0, ranDespite: 0, decisionRequests: 0, coverage: null };
}

/** Tenant-scoped; one grouped query for any number of agents (no per-agent queries). */
export async function getEnforcementCoverage(
  organizationId: string,
  agentIds: string[],
  options: { days?: number; now?: Date } = {}
): Promise<Map<string, EnforcementCoverage>> {
  const windowDays = Math.min(Math.max(options.days ?? 7, 1), 30);
  const since = new Date((options.now ?? new Date()).getTime() - windowDays * DAY_MS);
  const result = new Map<string, EnforcementCoverage>(agentIds.map((id) => [id, emptyCoverage(windowDays)]));
  if (agentIds.length === 0) return result;

  const rows = await prisma.$queryRaw<
    { agent_id: string; reported: number; decided: number; despite: number; requests: number }[]
  >`
    SELECT e."agentId" AS agent_id,
           COUNT(*) FILTER (WHERE e."source" = 'api' AND e."eventType" NOT IN ('SYSTEM', 'MODEL_CALL'))::int AS reported,
           COUNT(*) FILTER (WHERE e."source" = 'api' AND e."eventType" NOT IN ('SYSTEM', 'MODEL_CALL') AND e."evaluationId" IS NOT NULL)::int AS decided,
           COUNT(*) FILTER (WHERE e."source" = 'api' AND e."evaluationId" IS NOT NULL AND e."outcome" IN ('SUCCESS', 'WARNING')
                              AND p."decision" IN ('BLOCK', 'REQUIRE_APPROVAL'))::int AS despite,
           COUNT(*) FILTER (WHERE e."source" = 'policy_evaluation')::int AS requests
      FROM "activity_events" e
      LEFT JOIN "policy_evaluations" p ON p."id" = e."evaluationId" AND p."organizationId" = e."organizationId"
     WHERE e."organizationId" = ${organizationId}
       AND e."agentId" IN (${Prisma.join(agentIds)})
       AND e."timestamp" >= ${since.toISOString()}::timestamp
     GROUP BY e."agentId"`;

  for (const r of rows) {
    const reported = Number(r.reported);
    const decided = Number(r.decided);
    result.set(r.agent_id, {
      windowDays,
      reportedActions: reported,
      decided,
      undecided: Math.max(reported - decided, 0),
      ranDespite: Number(r.despite),
      decisionRequests: Number(r.requests),
      coverage: reported > 0 ? decided / reported : null,
    });
  }
  return result;
}
