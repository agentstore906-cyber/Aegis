import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";
import { agentRegisterSchema } from "@/lib/validation/api";
import { AgentRegistrationNotAuthorizedError, registerAgent } from "@/lib/agents/register";
import { AgentLimitReachedError } from "@/lib/agents/creation-guard";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * POST /api/v1/agents/register — lightweight auto-provisioning so the SDK
 * quickstart doesn't require a dashboard visit before the first /events or
 * /evaluate call. Upserts by name-derived slug (see lib/agents/register.ts)
 * — calling it again with the same name returns the existing agent.
 * Creating a *new* agent requires an organization-wide key and is subject
 * to the plan's agent limit (403 PLAN_LIMIT_REACHED).
 */
export const POST = withApiAuth("agents.register", "events:write", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = agentRegisterSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  const result = await withIdempotency(
    {
      organizationId: ctx.organization.id,
      apiKeyId: ctx.apiKey.id,
      operation: "agents.register",
      idempotencyKey,
      requestBody: rawBody,
    },
    async () => {
      const { agent, created } = await registerAgent(ctx.organization.id, parsed.data, {
        agentId: ctx.apiKey.agentId,
        organizationId: ctx.apiKey.organizationId,
        apiKeyId: ctx.apiKey.id,
      }).catch((error: unknown) => {
        if (error instanceof AgentLimitReachedError) throw new ApiError("PLAN_LIMIT_REACHED", error.message, 403);
        if (error instanceof AgentRegistrationNotAuthorizedError) {
          throw new ApiError("AGENT_NOT_AUTHORIZED", error.message, 403);
        }
        throw error;
      });
      ctx.setAgentId(agent.id);
      return { status: created ? 201 : 200, body: { id: agent.id, slug: agent.slug, name: agent.name, created } };
    }
  );

  return Response.json(result.body, { status: result.status });
});
