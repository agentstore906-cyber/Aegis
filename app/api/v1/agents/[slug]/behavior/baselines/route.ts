import { behaviorRoute, intParam } from "@/lib/api/behavior-route";
import { getBaselineVersion, listBaselineVersions } from "@/lib/behavior/queries";
import { ApiError } from "@/lib/api/errors";

/**
 * GET /api/v1/agents/:slug/behavior/baselines            — version history (metadata)
 * GET /api/v1/agents/:slug/behavior/baselines?version=N  — one historical version, full profile, exactly as computed
 * Baseline versions are immutable (DB-enforced). Scope: behavior:read.
 */
export const GET = behaviorRoute("behavior.baselines", async ({ ctx, agentId, url }) => {
  if (url.searchParams.has("version")) {
    const version = intParam(url, "version", 1, 1, 1_000_000);
    const baseline = await getBaselineVersion(ctx.organization.id, agentId, version);
    if (!baseline) throw new ApiError("BASELINE_NOT_FOUND", `Baseline version ${version} does not exist for this agent.`, 404);
    return Response.json({
      version: baseline.version,
      methodologyVersion: baseline.methodologyVersion,
      maturity: baseline.maturity,
      windowStart: baseline.windowStart.toISOString(),
      windowEnd: baseline.windowEnd.toISOString(),
      eventsObserved: baseline.eventsObserved,
      activeDays: baseline.activeDays,
      activeHours: baseline.activeHours,
      computedAt: baseline.computedAt.toISOString(),
      profile: baseline.profile,
    });
  }

  const versions = (await listBaselineVersions(ctx.organization.id, agentId, intParam(url, "limit", 30, 1, 100))) ?? [];
  return Response.json({
    baselines: versions.map((v) => ({
      ...v,
      windowStart: v.windowStart.toISOString(),
      windowEnd: v.windowEnd.toISOString(),
      computedAt: v.computedAt.toISOString(),
    })),
  });
});
