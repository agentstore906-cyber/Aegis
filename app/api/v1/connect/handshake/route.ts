import { z } from "zod";

import { withApiAuth } from "@/lib/api/handler";
import { readJsonBody } from "@/lib/api/request";
import { ApiError } from "@/lib/api/errors";
import { HandshakeError, recordHandshake } from "@/lib/agents/handshake";

const MAX_BODY_BYTES = 2 * 1024;

const handshakeSchema = z.object({
  sdkVersion: z.string().trim().min(1).max(40).optional(),
  framework: z.string().trim().min(1).max(60).optional(),
});

/**
 * POST /api/v1/connect/handshake — "this is my agent, calling for the first time."
 *
 * The agent is the one the key is BOUND to; the body cannot name another. Authenticating, being in range of the
 * rate limit and holding a key bound to a live agent connection is the whole proof, and it is recorded
 * (AgentConnection.firstHandshakeAt / lastSeenAt, one audit event the first time). Idempotent: a retry or a
 * replay returns the same connection and records nothing new. See docs/AEGIS_AGENT_CONNECTION.md.
 */
export const POST = withApiAuth("connect.handshake", "events:write", async (request, ctx) => {
  const parsed = handshakeSchema.safeParse(await readJsonBody(request, MAX_BODY_BYTES));
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request body.", 400);

  try {
    const result = await recordHandshake(ctx.apiKey, parsed.data);
    ctx.setAgentId(result.agent.id);
    return Response.json({
      connected: true,
      established: result.established,
      agent: { slug: result.agent.slug, name: result.agent.name },
      firstHandshakeAt: result.firstHandshakeAt.toISOString(),
      lastSeenAt: result.lastSeenAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof HandshakeError) {
      if (error.code === "AGENT_CONNECTION_DISCONNECTED") throw new ApiError("AGENT_CONNECTION_DISCONNECTED", error.message, 409);
      throw new ApiError("AGENT_NOT_AUTHORIZED", error.message, 403);
    }
    throw error;
  }
});
