"use server";

import { attributeToScanner } from "@/lib/scanner/analytics";
import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import {
  discoverProviderConnection,
  connectProviderAgent,
  checkConnectionHealth,
  reconnectAgentConnection,
  disconnectAgentConnection,
  AgentConnectionNotFoundError,
} from "@/lib/agents/connection-service";
import {
  discoverConnectionSchema,
  connectAgentSchema,
  connectEndpointSchema,
  reconnectAgentSchema,
} from "@/lib/validation/connect-agent";
import { connectEndpointAgent } from "@/lib/agents/endpoint-connection";
import { trackEvent } from "@/lib/analytics/track";

const PERMISSION_ERROR = "You don't have permission to connect agents.";

/** Read-only: verifies a credential and lists discoverable agents. Never persists anything. */
export async function discoverConnectionAction(input: unknown) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false as const, error: PERMISSION_ERROR };

  const parsed = discoverConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  return discoverProviderConnection(organization.id, parsed.data.connectorType, parsed.data.credential);
}

/** Creates the Agent + AgentConnection. Re-verifies the credential itself — never trusts the discovery step's result. */
export async function connectAgentAction(input: unknown) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false as const, error: PERMISSION_ERROR };

  const parsed = connectAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await connectProviderAgent({
    organizationId: organization.id,
    userId: user.id,
    ownerLabel: user.name?.trim() || user.email,
    connectorType: parsed.data.connectorType,
    credential: parsed.data.credential,
    selectedExternalId: parsed.data.selectedExternalId,
    agentName: parsed.data.agentName,
    environment: parsed.data.environment,
  });

  if (result.ok) {
    trackEvent("agent_connected", { organizationId: organization.id, agentId: result.agentId });
    await attributeToScanner(organization.id, "agent_connected");
    revalidatePath("/agents");
  }

  return result;
}

/**
 * Connect an external agent: Aegis connects TO it and verifies it before anything is created. The shared secret travels
 * browser → this action once (over the app's own TLS), is used for the verification, and is stored encrypted; it is
 * never returned to the browser. The caller never names an agent: the organization comes from the session and the
 * agent identifies itself to Aegis.
 */
export async function connectEndpointAgentAction(input: unknown) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false as const, code: "FORBIDDEN" as const, error: PERMISSION_ERROR };

  const parsed = connectEndpointSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, code: "INVALID" as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await connectEndpointAgent({
    organizationId: organization.id,
    userId: user.id,
    ownerLabel: user.name?.trim() || user.email,
    endpointUrl: parsed.data.endpointUrl,
    secret: parsed.data.secret,
    displayName: parsed.data.displayName,
    environment: parsed.data.environment,
  });
  if (!result.ok) return { ok: false as const, code: result.code, error: result.error };

  trackEvent("agent_connected", { organizationId: organization.id, agentId: result.agentId });
  await attributeToScanner(organization.id, "agent_connected");
  revalidatePath("/agents");
  revalidatePath("/risk-scan");
  return { ok: true as const, agentSlug: result.agentSlug, agentName: result.agentName, verifiedAtIso: result.verifiedAt.toISOString(), reconnected: result.reconnected };
}

/** On-demand connection health check — see connection-service.ts for why there's no background polling. */
export async function checkConnectionHealthAction(agentSlug: string) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false as const, error: PERMISSION_ERROR };

  try {
    const result = await checkConnectionHealth(organization.id, agentSlug);
    revalidatePath(`/agents/${agentSlug}`);
    return result;
  } catch (error) {
    if (error instanceof AgentConnectionNotFoundError) return { ok: false as const, error: error.message };
    throw error;
  }
}

export async function reconnectAgentAction(agentSlug: string, input: unknown) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false as const, error: PERMISSION_ERROR };

  const parsed = reconnectAgentSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await reconnectAgentConnection(organization.id, user.id, agentSlug, parsed.data.credential);
    if (result.ok) revalidatePath(`/agents/${agentSlug}`);
    return result;
  } catch (error) {
    if (error instanceof AgentConnectionNotFoundError) return { ok: false as const, error: error.message };
    throw error;
  }
}

export async function disconnectAgentAction(agentSlug: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { error: PERMISSION_ERROR };

  try {
    await disconnectAgentConnection(organization.id, user.id, agentSlug);
    revalidatePath(`/agents/${agentSlug}`);
    return {};
  } catch (error) {
    if (error instanceof AgentConnectionNotFoundError) return { error: error.message };
    throw error;
  }
}
