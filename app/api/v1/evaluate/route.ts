import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";
import { evaluateRequestSchema } from "@/lib/validation/api";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import { LineageReferenceError } from "@/lib/telemetry/lineage";
import { touchConnection } from "@/lib/agents/handshake";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/v1/evaluate — "may my agent do this?" A thin wrapper around
 * evaluateAgentAction() (lib/policies/evaluate.ts): kill switch, trusted
 * context, policy, single-use approval consumption, all in one decision.
 * The key must be authorized for the named agent (lib/api/agent-access.ts).
 * See docs/api.md for the full request/response contract.
 */
export const POST = withApiAuth("evaluate.create", "policy:evaluate", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = evaluateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }

  const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, parsed.data.agent);
  if (agent.connection?.status === "DISCONNECTED") {
    throw new ApiError(
      "AGENT_CONNECTION_DISCONNECTED",
      `Agent \`${parsed.data.agent}\` has been disconnected. Reconnect it in Aegis before requesting authorization.`,
      409
    );
  }
  ctx.setAgentId(agent.id);
  // Contact evidence: a key bound to this agent reached Aegis. Never fails the request.
  await touchConnection(agent, ctx.apiKey, { activity: true }).catch(() => undefined);

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
        approvalRequestId: parsed.data.approvalRequestId,
        contextSource: "agent",
        apiKeyAgentId: ctx.apiKey.agentId,
        telemetry: {
          service: parsed.data.service,
          destination: parsed.data.destination,
          endUserId: parsed.data.endUserId,
          dataClasses: parsed.data.dataClasses,
          dataSensitivity: parsed.data.dataSensitivity,
          recordCount: parsed.data.recordCount,
          byteCount: parsed.data.byteCount,
          parentEventId: parsed.data.parentEventId,
          parentClientEventId: parsed.data.parentClientEventId,
        },
      }).catch((error: unknown) => {
        // A bad parent reference is the caller's error, not an engine failure.
        if (error instanceof LineageReferenceError) throw new ApiError(error.code, error.message, 400);
        console.error(JSON.stringify({ msg: "evaluate_failed", agentId: agent.id, error: String(error) }));
        throw new ApiError("POLICY_EVALUATION_FAILED", "Aegis could not evaluate this action.", 502);
      });

      // Additive to the original { decision, evaluationId, traceId,
      // approvalRequestId?, reason? } contract — see docs/api.md.
      const body: Record<string, unknown> = {
        decision: evaluation.decision,
        evaluationId: evaluation.evaluationId,
        traceId: evaluation.traceId,
        reason: evaluation.reason,
        decisionSource: evaluation.decisionSource,
        agentStatus: evaluation.agentStatus,
      };
      if (evaluation.decision === "REQUIRE_APPROVAL") {
        body.approvalRequestId = evaluation.approvalRequestId;
        body.approvalExpiresAt = evaluation.approvalExpiresAt?.toISOString() ?? null;
      }
      if (evaluation.consumedApprovalRequestId) body.consumedApprovalRequestId = evaluation.consumedApprovalRequestId;
      if (evaluation.approvalDenialCode) body.approvalDenialCode = evaluation.approvalDenialCode;

      return { status: 200, body };
    }
  );

  return Response.json(result.body, { status: result.status });
});
