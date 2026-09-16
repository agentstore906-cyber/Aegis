import "server-only";

import { prisma } from "@/lib/db";
import type { AgentConnector, ConnectorCapabilities, ConnectorContext } from "@/lib/connectors/types";

/**
 * The connector for agents that can't be discovered through any provider
 * API — a custom/in-house agent, or one built on a framework Aegis has no
 * integration with. There is no third-party credential to verify: the
 * real connection mechanism is the existing Aegis SDK / API-key ingestion
 * pipeline (POST /api/v1/events, /api/v1/agents/register), which
 * lib/agents/connection-service.ts wires up automatically at connect time
 * (see the auto-provisioned ApiKey). "Health" for this connector means
 * "is the ingestion pipeline itself still usable" — whether the
 * connection's own API key is still active — not a call to any external
 * service, because there is no external service here to call.
 */
const CAPABILITIES: ConnectorCapabilities = {
  agentDiscovery: false,
  activityMonitoring: true,
  usageMonitoring: false,
  costMonitoring: false,
  pauseAgent: false,
  killSwitch: false,
  credentialVerification: false,
};

export const customConnector: AgentConnector = {
  type: "CUSTOM_SDK",
  displayName: "Custom Agent",
  capabilities: CAPABILITIES,

  async verifyCredential() {
    // Nothing external to verify — connecting a custom agent never fails
    // this step.
    return { ok: true, accountLabel: "Aegis SDK" };
  },

  async discoverAgents() {
    return [];
  },

  async getDiscoveredAgent() {
    return null;
  },

  async healthCheck(ctx: ConnectorContext) {
    if (!ctx.agentId) return { ok: true };
    const connection = await prisma.agentConnection.findUnique({
      where: { agentId: ctx.agentId },
      select: { apiKeyId: true },
    });
    if (!connection?.apiKeyId) return { ok: true };

    const apiKey = await prisma.apiKey.findUnique({
      where: { id: connection.apiKeyId },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!apiKey) return { ok: false, error: "The API key for this connection no longer exists." };
    if (apiKey.revokedAt) return { ok: false, error: "The API key for this connection was revoked." };
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      return { ok: false, error: "The API key for this connection has expired." };
    }
    return { ok: true };
  },
};
