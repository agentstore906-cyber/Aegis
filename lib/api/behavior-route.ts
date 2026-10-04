import "server-only";

import { z } from "zod";

import { withApiAuth, type ApiContext } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";

/**
 * Shared wrapper for the read-only behavioral-memory endpoints
 * (GET /api/v1/agents/:slug/behavior/*). Scope `behavior:read`; the agent is
 * resolved inside the key's organization and checked against the key's agent
 * binding (P0 §7) — a bound key can only read its own agent's behavior.
 */
type SlugContext = { params: Promise<{ slug: string }> };

export const BEHAVIOR_SCOPE = "behavior:read";

export function behaviorRoute(
  endpoint: string,
  handler: (args: { request: Request; ctx: ApiContext; agentId: string; url: URL }) => Promise<Response>
) {
  return withApiAuth<SlugContext>(endpoint, BEHAVIOR_SCOPE, async (request, ctx, routeContext) => {
    const { slug } = await routeContext.params;
    const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, slug);
    ctx.setAgentId(agent.id);
    return handler({ request, ctx, agentId: agent.id, url: new URL(request.url) });
  });
}

/** Parses an optional bounded integer query parameter, rejecting junk with 400. */
export function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const parsed = z.coerce.number().int().min(min).max(max).safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", `\`${name}\` must be an integer between ${min} and ${max}.`, 400);
  }
  return parsed.data;
}
