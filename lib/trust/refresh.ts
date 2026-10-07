import "server-only";

import { prisma } from "@/lib/db";
import { evaluateTrust } from "@/lib/trust/evaluate";

/**
 * Scheduled trust maintenance (P3): re-evaluates agents, least-recently
 * evaluated first, within a time budget. Trust decays with time, so an agent
 * that goes quiet recovers even though no new event ever triggers an
 * evaluation; this guarantees that happens at least daily (reads also
 * re-evaluate when stale). Archived agents are skipped. One agent's failure
 * never stops the run. Production sweeps every organization;
 * `organizationIds` narrows the sweep (used by tests so they stay hermetic).
 */
export async function refreshTrust(options: { budgetMs: number; limit: number; now?: Date; organizationIds?: string[] }) {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  // Never-evaluated agents first, then the least recently evaluated.
  const select = { id: true, organizationId: true } as const;
  const scope = options.organizationIds ? { organizationId: { in: options.organizationIds } } : {};
  const never = await prisma.agent.findMany({
    where: { status: { not: "ARCHIVED" }, trustState: { is: null }, ...scope },
    select,
    take: options.limit,
  });
  const stale =
    never.length < options.limit
      ? await prisma.agent.findMany({
          where: { status: { not: "ARCHIVED" }, trustState: { isNot: null }, ...scope },
          select,
          orderBy: { trustState: { evaluatedAt: "asc" } },
          take: options.limit - never.length,
        })
      : [];
  const agents = [...never, ...stale];

  let processed = 0;
  let recorded = 0;
  let failed = 0;
  for (const agent of agents) {
    if (Date.now() - startedAt > options.budgetMs) break;
    try {
      const result = await evaluateTrust(agent.organizationId, agent.id, { trigger: "SCHEDULED", now });
      processed += 1;
      if (result?.recorded) recorded += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ msg: "trust_refresh_failed", agentId: agent.id, error: String(error) }));
    }
  }
  return { candidates: agents.length, processed, recordedTransitions: recorded, failed, durationMs: Date.now() - startedAt };
}
