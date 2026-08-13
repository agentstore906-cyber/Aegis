import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";
import { evaluateRequestSchema } from "@/lib/validation/api";
import { getAgentBySlugRaw } from "@/lib/agents/queries";
import { evaluateAgentAction } from "@/lib/policies/evaluate";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/v1/evaluate — "may my agent do this?" A thin wrapper around
 * evaluateAgentAction() (lib/policies/evaluate.ts), unchanged from the
 * dashboard's own policy tester — it already creates the ApprovalRequest
 * + audit event on REQUIRE_APPROVAL, and is already organization-scoped.
 * See docs/api.md for the full request/response contract.
 */
export const POST = withApiAuth("evaluate.create", "policy:evaluate", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = evaluateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }

  const agent = await getAgentBySlugRaw(ctx.organization.id, parsed.data.agent);
  if (!agent) {
    throw new ApiError("AGENT_NOT_FOUND", `Agent \`${parsed.data.agent}\` was not found in this organization.`, 404);
  }
  ctx.setAgentId(agent.id);

  const idempotencyKey = request.headers.get("idempotency-key");

  const result = await withIdempotency(
    {
      organizationId: ctx.organization.id,
      apiKeyId: ctx.apiKey.id,
      operation: "evaluate.create",
      idempotencyKey,
      requestBody: rawBody,
    },
    async () => {
      const evaluation = await evaluateAgentAction({
        organizationId: ctx.organization.id,
        agentId: agent.id,
        action: parsed.data.action,
        resource: parsed.data.resource,
        environment: parsed.data.environment,
        tool: parsed.data.tool,
        riskLevel: parsed.data.riskLevel,
        context: parsed.data.context,
        traceId: parsed.data.traceId,
      }).catch((error: unknown) => {
        console.error(JSON.stringify({ msg: "evaluate_failed", agentId: agent.id, error: String(error) }));
        throw new ApiError("POLICY_EVALUATION_FAILED", "Aegis could not evaluate this action.", 502);
      });

      const body: Record<string, unknown> = {
        decision: evaluation.decision,
        evaluationId: evaluation.evaluationId,
        traceId: evaluation.traceId,
      };
      if (evaluation.decision === "REQUIRE_APPROVAL") body.approvalRequestId = evaluation.approvalRequestId;
      if (evaluation.decision === "BLOCK") body.reason = evaluation.reason;

      return { status: 200, body };
    }
  );

  return Response.json(result.body, { status: result.status });
});
