import { trustRoute } from "@/lib/api/trust-route";
import { ApiError } from "@/lib/api/errors";
import { getTrust } from "@/lib/trust/queries";
import { serializeTrust } from "@/lib/trust/serialize";

/**
 * GET /api/v1/agents/:slug/trust — "what is this agent's current trust
 * state?" State, score, since when, and a one-sentence reason. Evaluated
 * first when never evaluated or stale. Informational: trust blocks nothing.
 * Scope: trust:read. See docs/AEGIS_P3_AGENT_TRUST.md.
 */
export const GET = trustRoute("trust.current", async ({ ctx, agentId }) => {
  const trust = await getTrust(ctx.organization.id, agentId);
  if (!trust) throw new ApiError("AGENT_NOT_FOUND", "Agent not found in this organization.", 404);
  return Response.json({ trust: serializeTrust(trust) });
});
