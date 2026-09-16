import "server-only";

import { fetchWithTimeout } from "@/lib/connectors/fetch-with-timeout";
import type { AgentConnector, ConnectorCapabilities, ConnectorContext } from "@/lib/connectors/types";

const API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic has no OAuth flow for third-party API access, and — unlike
 * OpenAI's Assistants API — no assistants/agents-list endpoint at all:
 * the Messages API is stateless, so there is nothing to discover.
 * `GET /v1/models` is used purely to verify the key actually authenticates
 * (a real technical check with no cost/side-effects), and discovery
 * always returns an empty list — never invented. The UI asks the user to
 * name their agent because there is nothing else Aegis can truthfully
 * fill in from the API.
 */
const CAPABILITIES: ConnectorCapabilities = {
  agentDiscovery: false,
  activityMonitoring: true,
  usageMonitoring: false,
  costMonitoring: false,
  pauseAgent: false,
  killSwitch: false,
  credentialVerification: true,
};

function authHeaders(credential: string): Record<string, string> {
  return {
    "x-api-key": credential,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

export const anthropicConnector: AgentConnector = {
  type: "ANTHROPIC",
  displayName: "Anthropic",
  capabilities: CAPABILITIES,

  async verifyCredential(ctx: ConnectorContext) {
    if (!ctx.credential) return { ok: false, error: "No API key was provided." };
    try {
      const response = await fetchWithTimeout(`${API_BASE}/models`, { headers: authHeaders(ctx.credential) });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "The provider rejected the connection." };
      }
      if (!response.ok) {
        return { ok: false, error: "We couldn't connect this agent." };
      }
      return { ok: true, accountLabel: "Anthropic account" };
    } catch {
      return { ok: false, error: "We couldn't reach Anthropic. Try again in a moment." };
    }
  },

  // No discovery API exists for Anthropic — always honest about that.
  async discoverAgents() {
    return [];
  },

  async getDiscoveredAgent() {
    return null;
  },

  async healthCheck(ctx: ConnectorContext) {
    return this.verifyCredential(ctx);
  },
};
