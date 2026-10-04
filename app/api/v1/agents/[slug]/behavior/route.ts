import { behaviorRoute } from "@/lib/api/behavior-route";
import { getBehaviorProfile } from "@/lib/behavior/queries";
import { ApiError } from "@/lib/api/errors";
import { serializeDeviation } from "@/lib/behavior/serialize";

/**
 * GET /api/v1/agents/:slug/behavior — "what is normal for this agent?"
 * The current baseline (computed first if today's learning window isn't
 * covered yet), its maturity, the full profile, and the last 7 days of
 * deviations. Scope: behavior:read. See docs/AEGIS_P2_BEHAVIORAL_MEMORY.md.
 */
export const GET = behaviorRoute("behavior.profile", async ({ ctx, agentId }) => {
  const result = await getBehaviorProfile(ctx.organization.id, agentId);
  if (!result) throw new ApiError("AGENT_NOT_FOUND", "Agent not found in this organization.", 404);
  return Response.json({
    baseline: {
      ...result.baseline,
      windowStart: result.baseline.windowStart.toISOString(),
      windowEnd: result.baseline.windowEnd.toISOString(),
      computedAt: result.baseline.computedAt.toISOString(),
    },
    profile: result.profile,
    recentDeviations: result.recentDeviations.map(serializeDeviation),
  });
});
