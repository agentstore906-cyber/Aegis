import type { MemberRole } from "@prisma/client";

import { canManageAgents } from "@/lib/agents/authorization";

/**
 * Running a benchmark reads an agent's configuration and activity and
 * creates an ArenaScorecard — no different in blast radius from connecting
 * or editing an agent, so it reuses the same capability rather than
 * inventing a new one.
 */
export function canRunArenaBenchmark(role: MemberRole): boolean {
  return canManageAgents(role);
}

/** Publishing a scorecard is a sharing decision — same bar as running one. */
export function canPublishArenaScorecard(role: MemberRole): boolean {
  return canManageAgents(role);
}
