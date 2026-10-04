import { trustRoute } from "@/lib/api/trust-route";
import { ApiError } from "@/lib/api/errors";
import { getTrust } from "@/lib/trust/queries";
import { serializeReasons } from "@/lib/trust/serialize";

/**
 * GET /api/v1/agents/:slug/trust/reasons — "why?" Every piece of evidence
 * currently lowering trust (with points and evidence ids), the limits that
 * bound it (operator control, insufficient history), per-category totals and
 * caps, and the state thresholds. Scope: trust:read.
 */
export const GET = trustRoute("trust.reasons", async ({ ctx, agentId }) => {
  const trust = await getTrust(ctx.organization.id, agentId);
  if (!trust) throw new ApiError("AGENT_NOT_FOUND", "Agent not found in this organization.", 404);
  return Response.json(serializeReasons(trust));
});
