import { behaviorRoute, intParam } from "@/lib/api/behavior-route";
import { listDeviations } from "@/lib/behavior/queries";
import { serializeDeviation } from "@/lib/behavior/serialize";

/**
 * GET /api/v1/agents/:slug/behavior/deviations?days=7&limit=50
 * Recent deviations from the agent's baseline, most recent first, each with
 * what changed, why it's unusual, and what was expected. Scope: behavior:read.
 */
export const GET = behaviorRoute("behavior.deviations", async ({ ctx, agentId, url }) => {
  const deviations =
    (await listDeviations(ctx.organization.id, agentId, {
      days: intParam(url, "days", 7, 1, 90),
      limit: intParam(url, "limit", 50, 1, 200),
    })) ?? [];
  return Response.json({ deviations: deviations.map(serializeDeviation) });
});
