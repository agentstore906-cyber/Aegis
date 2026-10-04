import "server-only";

import { prisma } from "@/lib/db";
import { ensureBaseline } from "@/lib/behavior/baseline";

/**
 * Scheduled maintenance (P2): rolls up closed hours and appends today's
 * baseline version for agents, least-recently-refreshed first, within a time
 * budget. Lazy refresh (on the first observed event or view of the day) is
 * the primary mechanism and keeps everything correct without a scheduler;
 * this only pre-computes, so the first request of the day doesn't pay for it.
 * Archived agents are skipped. Each agent is processed independently — one
 * failure never stops the run.
 */
export async function refreshStaleBaselines(options: { budgetMs: number; limit: number; now?: Date }) {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const agents = await prisma.agent.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: { id: true, organizationId: true },
    orderBy: { behaviorState: { lastRefreshedAt: { sort: "asc", nulls: "first" } } },
    take: options.limit,
  });

  let processed = 0;
  let failed = 0;
  for (const agent of agents) {
    if (Date.now() - startedAt > options.budgetMs) break;
    try {
      await ensureBaseline(agent.organizationId, agent.id, now);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ msg: "behavior_refresh_failed", agentId: agent.id, error: String(error) }));
    }
  }
  return { candidates: agents.length, processed, failed, durationMs: Date.now() - startedAt };
}
