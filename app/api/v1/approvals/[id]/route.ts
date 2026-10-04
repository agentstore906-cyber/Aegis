import { withApiAuth } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { getApprovalStatus } from "@/lib/approvals/service";
import { apiKeyMayActAsAgent } from "@/lib/api-keys/agent-binding";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/approvals/:id — lets an agent poll a REQUIRE_APPROVAL
 * decision it received from /evaluate until a human resolves it in the
 * dashboard. A thin wrapper around getApprovalStatus() (lib/approvals/
 * service.ts) — already organization-scoped and already lazily expires a
 * PENDING request past its expiresAt. See docs/api.md.
 *
 * APPROVED here is not by itself permission to act: the approval is a
 * single-use grant that the agent consumes by calling POST /evaluate again
 * with `approvalRequestId` (see lib/approvals/binding.ts). A key bound to
 * one agent can only read that agent's approvals — anything else is
 * reported as not found, so it can't probe other agents' requests.
 */
export const GET = withApiAuth<RouteContext>("approvals.get", "approvals:read", async (_request, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const request = await getApprovalStatus(ctx.organization.id, id);

  if (
    !request ||
    !apiKeyMayActAsAgent(
      { agentId: ctx.apiKey.agentId, organizationId: ctx.apiKey.organizationId },
      { id: request.agentId, organizationId: request.organizationId }
    )
  ) {
    throw new ApiError("APPROVAL_NOT_FOUND", `Approval request \`${id}\` was not found in this organization.`, 404);
  }

  ctx.setAgentId(request.agentId);

  const latestDecision = request.decisions[0];

  return Response.json({
    id: request.id,
    status: request.status,
    decision: latestDecision ? latestDecision.decision : null,
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
    expiresAt: request.expiresAt ? request.expiresAt.toISOString() : null,
    executionExpiresAt: request.executionExpiresAt ? request.executionExpiresAt.toISOString() : null,
    consumed: request.consumedAt !== null,
    consumedAt: request.consumedAt ? request.consumedAt.toISOString() : null,
  });
});
