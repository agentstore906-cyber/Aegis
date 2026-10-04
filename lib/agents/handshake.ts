import "server-only";

import type { ApiKey } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { customConnector } from "@/lib/connectors/custom";
import { SEEN_WRITE_INTERVAL_MS } from "@/lib/agents/connection-state";
import type { Prisma } from "@prisma/client";

/**
 * Connection evidence. The ONLY things that move a connection from "waiting" to "connected":
 * a request that authenticated with a credential BOUND TO THIS AGENT reached Aegis. A dashboard click never does.
 *
 *   recordHandshake   POST /api/v1/connect/handshake — the explicit "hello" an SDK or integration sends.
 *   touchConnection   called by /events and /evaluate after the key was authorized for the agent, so an agent
 *                     that starts reporting without ever calling handshake is still recognised, truthfully.
 *
 * Both are idempotent: repeating a handshake (a retry, a replay, a duplicate) records nothing new — the
 * connection is already established, and `lastSeenAt` is written at most once a minute.
 * Organization-wide keys never count as contact: they do not prove WHICH agent is calling.
 */

export type HandshakeOutcome = {
  /** True only on the request that established (or re-established) the connection. */
  established: boolean;
  firstHandshakeAt: Date;
  lastSeenAt: Date;
};

type AgentRef = { id: string; organizationId: string; name: string };

export async function touchConnection(
  agent: Pick<AgentRef, "id" | "organizationId">,
  apiKey: Pick<ApiKey, "id" | "agentId">,
  options: { now?: Date; activity?: boolean } = {}
): Promise<{ established: boolean } | null> {
  // Only a key bound to exactly this agent is evidence of this agent's contact.
  if (apiKey.agentId !== agent.id) return null;
  const now = options.now ?? new Date();

  const connection = await prisma.agentConnection.findUnique({
    where: { agentId: agent.id },
    select: { id: true, status: true, firstHandshakeAt: true, lastSeenAt: true },
  });
  if (!connection || connection.status === "DISCONNECTED") return null;

  let established = false;
  // Waiting → connected, once. The status guard makes concurrent first requests establish exactly one connection.
  if (connection.status === "CONNECTING" || connection.status === "VERIFYING") {
    const moved = await prisma.agentConnection.updateMany({
      where: { id: connection.id, status: { in: ["CONNECTING", "VERIFYING"] } },
      data: { status: "CONNECTED", lastSeenAt: now, lastHealthError: null },
    });
    established = moved.count > 0;
    if (established) {
      await prisma.agentConnection.updateMany({ where: { id: connection.id, firstHandshakeAt: null }, data: { firstHandshakeAt: now } });
      await recordAuditEvent(prisma, {
        organizationId: agent.organizationId,
        actorType: "AGENT",
        agentId: agent.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_HANDSHAKE,
        entityType: "Agent",
        entityId: agent.id,
        action: "agent.handshake",
        metadata: { apiKeyId: apiKey.id },
      });
    }
  } else if (
    connection.firstHandshakeAt === null ||
    connection.lastSeenAt === null ||
    now.getTime() - connection.lastSeenAt.getTime() >= SEEN_WRITE_INTERVAL_MS
  ) {
    await prisma.agentConnection.updateMany({
      where: { id: connection.id, status: { not: "DISCONNECTED" } },
      data: { lastSeenAt: now, ...(connection.firstHandshakeAt === null ? { firstHandshakeAt: now } : {}) },
    });
  }

  if (options.activity) {
    // lastActiveAt was previously never written; the agent list and Arena read it.
    await prisma.agent.updateMany({
      where: { id: agent.id, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: new Date(now.getTime() - SEEN_WRITE_INTERVAL_MS) } }] },
      data: { lastActiveAt: now },
    });
  }
  return { established };
}

export class HandshakeError extends Error {
  constructor(
    readonly code: "AGENT_KEY_REQUIRED" | "AGENT_CONNECTION_DISCONNECTED",
    message: string
  ) {
    super(message);
    this.name = "HandshakeError";
  }
}

/**
 * The explicit handshake. Requires a key bound to an agent (the agent is the key's agent — the request does not
 * get to name one). An agent that predates the connection feature (registered through the API, no connection
 * row) gets one now: this request is real evidence of a working SDK connection, and the row records that.
 */
export async function recordHandshake(
  apiKey: Pick<ApiKey, "id" | "agentId" | "organizationId">,
  details: { sdkVersion?: string; framework?: string } = {},
  now: Date = new Date()
): Promise<HandshakeOutcome & { agent: { id: string; slug: string; name: string } }> {
  if (!apiKey.agentId) {
    throw new HandshakeError("AGENT_KEY_REQUIRED", "A handshake needs a key bound to one agent. Organization-wide keys cannot identify which agent is connecting.");
  }
  const agent = await prisma.agent.findFirst({
    where: { id: apiKey.agentId, organizationId: apiKey.organizationId },
    select: { id: true, organizationId: true, slug: true, name: true, connection: { select: { id: true, status: true } } },
  });
  // Cannot happen for a well-formed key (the binding cascades), but never trust it: no agent, no handshake.
  if (!agent) throw new HandshakeError("AGENT_KEY_REQUIRED", "This key is not bound to an agent in its organization.");
  if (agent.connection?.status === "DISCONNECTED") {
    throw new HandshakeError("AGENT_CONNECTION_DISCONNECTED", "This agent has been disconnected. Reconnect it in Aegis first.");
  }

  let established = false;
  if (!agent.connection) {
    const created = await prisma.agentConnection.create({
      data: {
        organizationId: agent.organizationId,
        agentId: agent.id,
        connectorType: "CUSTOM_SDK",
        status: "CONNECTED",
        apiKeyId: apiKey.id,
        capabilities: customConnector.capabilities as unknown as Prisma.InputJsonValue,
        externalAccountLabel: "Aegis SDK",
        firstHandshakeAt: now,
        lastSeenAt: now,
      },
    }).catch((error: unknown) => {
      // A concurrent first handshake created the row; this one is just a repeat.
      if ((error as { code?: string }).code === "P2002") return null;
      throw error;
    });
    if (created) {
      await recordAuditEvent(prisma, {
        organizationId: agent.organizationId,
        actorType: "AGENT",
        agentId: agent.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_HANDSHAKE,
        entityType: "Agent",
        entityId: agent.id,
        action: "agent.handshake",
        metadata: { apiKeyId: apiKey.id, createdConnectionRecord: true },
      });
      established = true;
    }
  } else {
    established = (await touchConnection(agent, apiKey, { now }))?.established ?? false;
  }

  if (details.sdkVersion || details.framework) {
    await prisma.agent.update({
      where: { id: agent.id },
      data: { ...(details.sdkVersion ? { sdkVersion: details.sdkVersion } : {}), ...(details.framework ? { framework: details.framework } : {}) },
    });
  }

  const connection = await prisma.agentConnection.findUniqueOrThrow({ where: { agentId: agent.id }, select: { firstHandshakeAt: true, lastSeenAt: true } });
  return {
    established,
    firstHandshakeAt: connection.firstHandshakeAt ?? now,
    lastSeenAt: connection.lastSeenAt ?? now,
    agent: { id: agent.id, slug: agent.slug, name: agent.name },
  };
}
