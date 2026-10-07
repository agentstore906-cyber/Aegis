import "server-only";

import { contactAgent, EndpointError } from "@/lib/connectors/endpoint-client";
import type { AgentConnector, ConnectorCapabilities, ConnectorContext } from "@/lib/connectors/types";

/**
 * The connector for an external agent that Aegis connects TO over aegis-agent/1
 * (docs/AEGIS_AGENT_ENDPOINT_PROTOCOL.md). There is no provider API here: the agent itself is the other end of the
 * connection, and "verified" means the agent answered a fresh, signed challenge with a proof only the shared secret
 * can produce. Nothing is discovered (the user supplies the endpoint) and nothing is fabricated.
 */
const CAPABILITIES: ConnectorCapabilities = {
  agentDiscovery: false,
  // Aegis does not receive activity from this connection by itself; activity only arrives if the agent also reports it.
  activityMonitoring: false,
  usageMonitoring: false,
  costMonitoring: false,
  pauseAgent: false,
  killSwitch: false,
  credentialVerification: true,
};

function describe(error: unknown): string {
  return error instanceof EndpointError ? error.message : "Aegis could not verify the agent.";
}

export const endpointConnector: AgentConnector = {
  type: "AEGIS_ENDPOINT",
  displayName: "Agent endpoint",
  capabilities: CAPABILITIES,

  async verifyCredential(ctx: ConnectorContext) {
    if (!ctx.credential) return { ok: false, error: "Enter the shared secret." };
    if (!ctx.endpointUrl) return { ok: false, error: "No endpoint is stored for this connection." };
    try {
      const agent = await contactAgent(ctx.endpointUrl, ctx.credential, "verify");
      return { ok: true, accountLabel: agent.name };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  },

  async discoverAgents() {
    return [];
  },

  /** For this connector `externalId` is the pinned agent id: returns the agent only if the endpoint STILL answers as that same agent. */
  async getDiscoveredAgent(ctx: ConnectorContext, externalId: string) {
    if (!ctx.credential || !ctx.endpointUrl) return null;
    try {
      const agent = await contactAgent(ctx.endpointUrl, ctx.credential, "verify");
      return agent.id === externalId ? { externalId: agent.id, name: agent.name } : null;
    } catch {
      return null;
    }
  },

  async healthCheck(ctx: ConnectorContext) {
    if (!ctx.credential) return { ok: false, error: "The shared secret is not stored. Reconnect to enter it again." };
    if (!ctx.endpointUrl) return { ok: false, error: "No endpoint is stored for this connection." };
    try {
      const agent = await contactAgent(ctx.endpointUrl, ctx.credential, "verify");
      if (ctx.externalAgentId && agent.id !== ctx.externalAgentId) {
        return { ok: false, error: "A different agent now answers at this endpoint. Aegis connected to another agent before, so it will not treat this one as the same." };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  },
};
