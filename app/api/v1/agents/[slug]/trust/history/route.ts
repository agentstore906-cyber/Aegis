import { trustRoute } from "@/lib/api/trust-route";
import { intParam } from "@/lib/api/behavior-route";
import { ApiError } from "@/lib/api/errors";
import { listTrustHistory } from "@/lib/trust/queries";
import { serializeTransition } from "@/lib/trust/serialize";

/**
 * GET /api/v1/agents/:slug/trust/history?limit=20&before=<sequence>
 * Trust transitions, newest first: previous → new state and score, the
 * triggering event, the explanation, and the factor snapshot as it was
 * recorded (immutable). Page with `nextBefore`. Scope: trust:read.
 */
export const GET = trustRoute("trust.history", async ({ ctx, agentId, url }) => {
  const before = url.searchParams.get("before");
  const page = await listTrustHistory(ctx.organization.id, agentId, {
    limit: intParam(url, "limit", 20, 1, 100),
    before: before ? intParam(url, "before", 0, 1, 2_000_000_000) : undefined,
  });
  if (!page) throw new ApiError("AGENT_NOT_FOUND", "Agent not found in this organization.", 404);
  return Response.json({ transitions: page.transitions.map(serializeTransition), nextBefore: page.nextBefore });
});
