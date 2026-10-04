import { graphRoute } from "@/lib/api/graph-route";
import { intParam } from "@/lib/api/behavior-route";
import { ApiError } from "@/lib/api/errors";
import { GRAPH_LIMITS, getRunGraph } from "@/lib/graph/queries";

/**
 * GET /api/v1/agents/:slug/graph/runs/:traceId — "what exactly did this
 * agent do in this run?" One page of the run's action graph: nodes, edges and
 * a parent/child timeline in temporal order, plus whole-run totals.
 * Keyset-paginated (`limit`, default 100, max 500; pass `page.nextCursor`
 * back as `cursor`). Only observable action/context metadata is returned —
 * reasoning-shaped context fields are withheld.
 * Scope: graph:read. See docs/AEGIS_P6_ACTION_GRAPH.md.
 */
export const GET = graphRoute("graph.run", async ({ ctx, agent, url, traceId }) => {
  if (!traceId) throw new ApiError("INVALID_REQUEST", "A trace id is required.", 400);
  const result = await getRunGraph(ctx.organization.id, agent, traceId, {
    cursor: url.searchParams.get("cursor"),
    limit: intParam(url, "limit", GRAPH_LIMITS.eventsDefault, 1, GRAPH_LIMITS.eventsMax),
  });
  if (!result) throw new ApiError("RUN_NOT_FOUND", "No run with this trace id exists for this agent.", 404);
  return Response.json({
    traceId: result.traceId,
    agent: { slug: result.agent.slug, name: result.agent.name },
    stats: result.stats,
    graph: result.graph,
    page: result.page,
  });
});
