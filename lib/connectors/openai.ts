import "server-only";

import { fetchWithTimeout } from "@/lib/connectors/fetch-with-timeout";
import type { AgentConnector, ConnectorCapabilities, ConnectorContext, DiscoveredAgent } from "@/lib/connectors/types";

const API_BASE = "https://api.openai.com/v1";

/**
 * OpenAI has no OAuth flow for third-party access to Platform API
 * resources — the only real connection mechanism is a secret API key the
 * user pastes in. Verification uses `GET /v1/models` (cheap, no
 * side-effects). Discovery uses the (beta) Assistants API — `GET
 * /v1/assistants` genuinely lists the assistants configured under that
 * key's project, which is real agent discovery, not a fabrication. Many
 * accounts have none (Assistants is being superseded by the Responses
 * API, and plenty of OpenAI-backed agents are just direct chat/completion
 * calls with no Assistants object at all) — that's reported as zero
 * discovered agents, never papered over.
 */
const CAPABILITIES: ConnectorCapabilities = {
  agentDiscovery: true,
  activityMonitoring: true,
  usageMonitoring: false,
  costMonitoring: false,
  pauseAgent: false,
  killSwitch: false,
  credentialVerification: true,
};

function authHeaders(credential: string): Record<string, string> {
  return {
    Authorization: `Bearer ${credential}`,
    "OpenAI-Beta": "assistants=v2",
  };
}

function toDiscoveredAgent(assistant: { id: string; name?: string | null; model?: string | null }): DiscoveredAgent {
  return {
    externalId: assistant.id,
    name: assistant.name?.trim() || `Assistant ${assistant.id.slice(-6)}`,
    model: assistant.model ?? null,
  };
}

export const openaiConnector: AgentConnector = {
  type: "OPENAI",
  displayName: "OpenAI",
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
      return { ok: true, accountLabel: "OpenAI account" };
    } catch {
      return { ok: false, error: "We couldn't reach OpenAI. Try again in a moment." };
    }
  },

  async discoverAgents(ctx: ConnectorContext) {
    if (!ctx.credential) return [];
    try {
      const response = await fetchWithTimeout(`${API_BASE}/assistants?limit=100&order=desc`, {
        headers: authHeaders(ctx.credential),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id: string; name?: string | null; model?: string | null }> };
      return (data.data ?? []).map(toDiscoveredAgent);
    } catch {
      return [];
    }
  },

  async getDiscoveredAgent(ctx: ConnectorContext, externalId: string) {
    if (!ctx.credential) return null;
    try {
      const response = await fetchWithTimeout(`${API_BASE}/assistants/${encodeURIComponent(externalId)}`, {
        headers: authHeaders(ctx.credential),
      });
      if (!response.ok) return null;
      const assistant = (await response.json()) as { id: string; name?: string | null; model?: string | null };
      return toDiscoveredAgent(assistant);
    } catch {
      return null;
    }
  },

  async healthCheck(ctx: ConnectorContext) {
    const verified = await this.verifyCredential(ctx);
    if (!verified.ok) return verified;
    if (ctx.externalAgentId) {
      const agent = await this.getDiscoveredAgent(ctx, ctx.externalAgentId);
      if (!agent) return { ok: false, error: "The connected assistant no longer exists on OpenAI." };
    }
    return { ok: true };
  },
};
