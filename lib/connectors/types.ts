import type { ConnectorType } from "@prisma/client";

/**
 * What a connector can actually do — rendered directly in the UI (never
 * show an affordance a connector doesn't list here as true) and persisted
 * as AgentConnection.capabilities at connect time. Every field is a
 * technical fact about the provider's API, not an aspiration:
 *
 *  - agentDiscovery: can Aegis list the caller's existing agents/assistants
 *    via the provider's own API, instead of asking the user to type a name?
 *  - activityMonitoring: can Aegis actually receive activity for this
 *    connection? True for every connector today because the receiving end
 *    (POST /api/v1/events) is always live once an Agent exists — but
 *    events still only arrive once something calls it (the SDK, or a
 *    direct API call). This is "the pipe is connected," not "data is
 *    flowing" — see the agent page's own "waiting for first activity"
 *    state for that distinction.
 *  - usageMonitoring / costMonitoring: can Aegis pull usage or spend
 *    directly from the provider's own API? Not implemented for any
 *    connector yet (OpenAI's and Anthropic's usage/cost APIs require a
 *    separate admin-level credential, not the connection credential) —
 *    always false today.
 *  - pauseAgent / killSwitch: can Aegis actually stop the agent at the
 *    provider? No provider here exposes that — always false. See
 *    lib/enforcement/ for why the in-app kill switch is a recorded intent,
 *    not an enforced one.
 *  - credentialVerification: did connecting require Aegis to verify a real
 *    credential against the provider's API (true for OPENAI/ANTHROPIC), or
 *    is there no external credential to verify (CUSTOM_SDK)?
 */
export type ConnectorCapabilities = {
  agentDiscovery: boolean;
  activityMonitoring: boolean;
  usageMonitoring: boolean;
  costMonitoring: boolean;
  pauseAgent: boolean;
  killSwitch: boolean;
  credentialVerification: boolean;
};

export type DiscoveredAgent = {
  externalId: string;
  name: string;
  model?: string | null;
};

export type ConnectorContext = {
  organizationId: string;
  /** Decrypted raw secret — present for OPENAI/ANTHROPIC, absent for CUSTOM_SDK. */
  credential?: string;
  /** The agent's own database id — CUSTOM_SDK's health check reads Agent/ApiKey state by this. */
  agentId?: string;
  /** Provider-side resource id (e.g. an OpenAI assistant id), when known. For AEGIS_ENDPOINT, the pinned id the agent declared. */
  externalAgentId?: string | null;
  /** AEGIS_ENDPOINT only: the endpoint Aegis connects to. */
  endpointUrl?: string | null;
};

export type VerifyResult = { ok: true; accountLabel: string } | { ok: false; error: string };
export type HealthResult = { ok: true } | { ok: false; error: string };

/**
 * A real, provider-specific connection mechanism. Every method is honest
 * about what it can do — a connector that can't discover agents returns an
 * empty list rather than fabricating one, and a connector with no
 * provider-side resource to health-check reports what it *can* verify
 * (e.g. CUSTOM_SDK checks Aegis's own ingestion key, not a third party).
 */
export interface AgentConnector {
  readonly type: ConnectorType;
  readonly displayName: string;
  readonly capabilities: ConnectorCapabilities;

  /** Confirms the credential (if any) actually authenticates against the provider. Never throws — returns ok:false instead. */
  verifyCredential(ctx: ConnectorContext): Promise<VerifyResult>;

  /** Lists the caller's existing agents/assistants, when the provider's API supports it. Best-effort: returns [] rather than throwing on a provider error. */
  discoverAgents(ctx: ConnectorContext): Promise<DiscoveredAgent[]>;

  /** Re-fetches one specific discovered agent's authoritative name/model, so a client never has to be trusted for that. Returns null if unsupported or not found. */
  getDiscoveredAgent(ctx: ConnectorContext, externalId: string): Promise<DiscoveredAgent | null>;

  /** Re-checks that the connection is still live — used by manual "Check connection" and reconnect. */
  healthCheck(ctx: ConnectorContext): Promise<HealthResult>;
}
