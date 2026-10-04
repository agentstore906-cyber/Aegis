import "server-only";

import { withApiAuth, type ApiContext } from "@/lib/api/handler";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";

/**
 * Shared wrapper for the read-only agent-trust endpoints
 * (GET /api/v1/agents/:slug/trust/*). Scope `trust:read`; the agent is
 * resolved inside the key's organization and checked against the key's agent
 * binding (P0 §7) — a bound key can only read its own agent's trust.
 */
type SlugContext = { params: Promise<{ slug: string }> };

export const TRUST_SCOPE = "trust:read";

export function trustRoute(
  endpoint: string,
  handler: (args: { request: Request; ctx: ApiContext; agentId: string; url: URL }) => Promise<Response>
) {
  return withApiAuth<SlugContext>(endpoint, TRUST_SCOPE, async (request, ctx, routeContext) => {
    const { slug } = await routeContext.params;
    const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, slug);
    ctx.setAgentId(agent.id);
    return handler({ request, ctx, agentId: agent.id, url: new URL(request.url) });
  });
}
