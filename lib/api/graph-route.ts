import "server-only";

import { withApiAuth, type ApiContext } from "@/lib/api/handler";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";

/**
 * Shared wrapper for the read-only action-graph endpoints
 * (GET /api/v1/agents/:slug/graph/*). Scope `graph:read`; the agent is
 * resolved inside the key's organization and checked against the key's agent
 * binding (P0 §7) — a bound key can only read its own agent's graph, and a
 * slug from another organization is a 404, never a read.
 */
type GraphRouteContext = { params: Promise<{ slug: string; traceId?: string }> };

export const GRAPH_SCOPE = "graph:read";

export type GraphAgent = { id: string; name: string; slug: string };

export function graphRoute(
  endpoint: string,
  handler: (args: { request: Request; ctx: ApiContext; agent: GraphAgent; url: URL; traceId?: string }) => Promise<Response>
) {
  return withApiAuth<GraphRouteContext>(endpoint, GRAPH_SCOPE, async (request, ctx, routeContext) => {
    const { slug, traceId } = await routeContext.params;
    const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, slug);
    ctx.setAgentId(agent.id);
    return handler({
      request,
      ctx,
      agent: { id: agent.id, name: agent.name, slug: agent.slug },
      url: new URL(request.url),
      traceId,
    });
  });
}
