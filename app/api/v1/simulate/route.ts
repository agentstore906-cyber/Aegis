import { adminRoute } from "@/lib/api/admin-route";
import { readJsonBody } from "@/lib/api/request";
import { ApiError } from "@/lib/api/errors";
import { evaluateRequestSchema } from "@/lib/validation/api";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";
import { simulateAgentAction } from "@/lib/control/simulate";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/v1/simulate — "what would Aegis do if this happened?" The same
 * request body as /evaluate, answered WITHOUT executing anything: nothing is
 * recorded, no approval is opened or consumed, no alert is raised, and the
 * agent's trust and history are untouched. The response explains the decision
 * stage by stage (kill switch, permission, policy, behavior, trust, risk, risk
 * control, approval) and states plainly that Aegis returns decisions rather
 * than guaranteeing they are honored.
 *
 * For CI / policy-as-code testing and governance tooling. Opt-in scope
 * `policy:simulate`; organization-wide keys only (the explanation reveals how
 * risk is detected). See docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §7.
 */
export const POST = adminRoute("simulate.create", "policy:simulate", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = evaluateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }
  if (parsed.data.approvalRequestId) {
    throw new ApiError("INVALID_REQUEST", "A simulation never uses or consumes an approval, so `approvalRequestId` is not accepted.", 400);
  }

  const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, parsed.data.agent);
  ctx.setAgentId(agent.id);

  const simulation = await simulateAgentAction({
    organizationId: ctx.organization.id,
    agentId: agent.id,
    action: parsed.data.action,
    resource: parsed.data.resource,
    environment: parsed.data.environment,
    tool: parsed.data.tool,
    riskLevel: parsed.data.riskLevel,
    context: parsed.data.context,
    contextSource: "agent",
    telemetry: {
      service: parsed.data.service,
      destination: parsed.data.destination,
      endUserId: parsed.data.endUserId,
      dataClasses: parsed.data.dataClasses,
      dataSensitivity: parsed.data.dataSensitivity,
      recordCount: parsed.data.recordCount,
      byteCount: parsed.data.byteCount,
    },
  });

  return Response.json({ simulation });
});
