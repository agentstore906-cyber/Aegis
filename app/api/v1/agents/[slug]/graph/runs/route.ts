import { graphRoute } from "@/lib/api/graph-route";
import { intParam } from "@/lib/api/behavior-route";
import { GRAPH_LIMITS, listRuns } from "@/lib/graph/queries";

/**
 * GET /api/v1/agents/:slug/graph/runs — "what has this agent been doing?"
 * The agent's runs (one per trace id), newest first, with counts of what
 * happened in each. Windowed (`days`, default 7, max 30) and keyset-paginated
 * (`limit`, default 20, max 50; pass `nextCursor` back as `cursor`).
 * Scope: graph:read. See docs/AEGIS_P6_ACTION_GRAPH.md.
 */
export const GET = graphRoute("graph.runs", async ({ ctx, agent, url }) => {
  const result = await listRuns(ctx.organization.id, agent.id, {
    days: intParam(url, "days", GRAPH_LIMITS.runWindowDaysDefault, 1, GRAPH_LIMITS.runWindowDaysMax),
    limit: intParam(url, "limit", GRAPH_LIMITS.runsDefault, 1, GRAPH_LIMITS.runsMax),
    cursor: url.searchParams.get("cursor"),
  });
  return Response.json({
    agent: { slug: agent.slug },
    windowDays: result.windowDays,
    since: result.since.toISOString(),
    scanTruncated: result.scanTruncated,
    ungroupedEvents: result.ungroupedEvents,
    nextCursor: result.nextCursor,
    runs: result.runs.map((r) => ({
      traceId: r.traceId,
      firstAction: r.firstAction,
      taskId: r.taskId,
      events: r.events,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
      blocked: r.blocked,
      approvalRequired: r.approvalRequired,
      maxRisk: r.maxRisk,
      tools: r.tools,
      destinations: r.destinations,
    })),
  });
});
