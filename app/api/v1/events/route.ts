import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";
import { eventIngestSchema } from "@/lib/validation/api";
import { resolveAuthorizedAgent } from "@/lib/api/agent-access";
import { ClientEventIdConflictError, ingestActivityEvent } from "@/lib/activity/ingest";
import { LineageReferenceError } from "@/lib/telemetry/lineage";
import { touchConnection } from "@/lib/agents/handshake";

function mapIngestError(error: unknown): never {
  if (error instanceof LineageReferenceError) throw new ApiError(error.code, error.message, 400);
  if (error instanceof ClientEventIdConflictError) throw new ApiError("CLIENT_EVENT_ID_CONFLICT", error.message, 409);
  throw error;
}

const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/v1/events — "here's what my agent already did." Records an
 * ActivityEvent directly; does not evaluate a policy (see /evaluate for
 * that). P1: optional structured telemetry (destination, data classes,
 * volume, end user, parent/child lineage, clientEventId dedup) — see
 * docs/AEGIS_P1_DATA_FOUNDATION.md and docs/api.md.
 */
export const POST = withApiAuth("events.create", "events:write", async (request, ctx) => {
  const rawBody = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = eventIngestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
  }

  const agent = await resolveAuthorizedAgent(ctx.apiKey, ctx.organization.id, parsed.data.agent);
  if (agent.connection?.status === "DISCONNECTED") {
    throw new ApiError(
      "AGENT_CONNECTION_DISCONNECTED",
      `Agent \`${agent.slug}\` has been disconnected. Reconnect it in Aegis before sending more activity.`,
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
      operation: "events.create",
      idempotencyKey,
      requestBody: rawBody,
    },
    async () => {
      const event = await ingestActivityEvent(ctx.organization.id, agent, parsed.data, {
        apiKeyAgentId: ctx.apiKey.agentId,
      }).catch(mapIngestError);
      // 201 for a newly recorded event; 200 when this delivery repeated an
      // already-recorded clientEventId (nothing new was written).
      return {
        status: event.duplicate ? 200 : 201,
        body: {
          id: event.id,
          traceId: event.traceId,
          parentEventId: event.parentEventId,
          duplicate: event.duplicate,
        },
      };
    }
  );

  return Response.json(result.body, { status: result.status });
});
