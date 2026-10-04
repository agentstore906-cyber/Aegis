import { behaviorRoute, intParam } from "@/lib/api/behavior-route";
import { getBehaviorHistory } from "@/lib/behavior/queries";

/**
 * GET /api/v1/agents/:slug/behavior/history?days=28
 * Historical behavior, one row per UTC day (oldest first), from the hourly
 * rollups of closed hours: events, records, bytes, distinct tools and
 * destinations, and deviations recorded that day. Scope: behavior:read.
 */
export const GET = behaviorRoute("behavior.history", async ({ ctx, agentId, url }) => {
  const history = (await getBehaviorHistory(ctx.organization.id, agentId, intParam(url, "days", 28, 1, 90))) ?? [];
  return Response.json({ history });
});
