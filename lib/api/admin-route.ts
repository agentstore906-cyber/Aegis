import "server-only";

import { withApiAuth, type ApiContext } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";

/**
 * Wrapper for the control-plane endpoints that are for ORGANIZATION-LEVEL
 * tooling, not agents: policy simulation and the agent inventory. On top of
 * withApiAuth's authentication, scope check, rate limit and logging:
 *
 *   - the scope is opt-in (lib/api-keys/scopes.ts), never a default scope;
 *   - a key bound to one agent is refused even if it somehow held the scope —
 *     these endpoints explain detection logic and expose other agents' state,
 *     which an agent's own credential must never reach.
 */
export function adminRoute<RouteContext = { params: Promise<Record<string, string>> }>(
  endpoint: string,
  requiredScope: string,
  handler: (request: Request, ctx: ApiContext, routeContext: RouteContext) => Promise<Response>
) {
  return withApiAuth<RouteContext>(endpoint, requiredScope, async (request, ctx, routeContext) => {
    if (ctx.apiKey.agentId !== null) {
      throw new ApiError(
        "AGENT_NOT_AUTHORIZED",
        "This endpoint is for organization-wide keys. A key bound to one agent cannot use it.",
        403
      );
    }
    return handler(request, ctx, routeContext);
  });
}
