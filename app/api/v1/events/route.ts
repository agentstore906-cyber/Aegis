import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";
import { eventIngestSchema } from "@/lib/validation/api";
import { getAgentBySlugRaw } from "@/lib/agents/queries";
import { ingestActivityEvent } from "@/lib/activity/ingest";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/v1/events — "here's what my agent already did." Records an
 * ActivityEvent directly; does not evaluate a policy (see /evaluate for
 * that). See docs/api.md for the full request/response contract.
 */
export const POST = withApiAuth("events.create", "events:write", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = eventIngestSchema.safeParse(rawBody);
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
      operation: "events.create",
      idempotencyKey,
      requestBody: rawBody,
    },
    async () => {
      const event = await ingestActivityEvent(ctx.organization.id, agent, parsed.data);
      return { status: 201, body: { id: event.id, traceId: event.traceId } };
    }
  );

  return Response.json(result.body, { status: result.status });
});
