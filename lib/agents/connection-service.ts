import "server-only";

import type { ConnectorType, Environment, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureUniqueAgentSlug } from "@/lib/agents/queries";
import { getConnector } from "@/lib/connectors/registry";
import {
  CredentialDecryptionError,
  decryptCredentialWithKeyInfo,
  encryptCredential,
  maskCredential,
} from "@/lib/connectors/crypto";
import type { ConnectorCapabilities, DiscoveredAgent } from "@/lib/connectors/types";
import { canCreateAgent, canCreateApiKey } from "@/lib/billing/entitlements";
import { AgentLimitReachedError, checkAgentLimitLocked } from "@/lib/agents/creation-guard";
import * as apiKeyRepo from "@/lib/api-keys/repository";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

/**
 * The real "Connect Agent" logic, split out from the "use server" Actions
 * (lib/agents/connect-actions.ts) so it's testable without a session — same
 * split as lib/agents/control.ts / lib/approvals/service.ts. Every function
 * here is org-scoped by an explicit organizationId argument, never inferred
 * from client input.
 */

export class AgentConnectionNotFoundError extends Error {
  constructor() {
    super("This agent has no connection.");
    this.name = "AgentConnectionNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Discovery — read-only, no persistence. Safe to call repeatedly while the
// user edits a credential field.
// ---------------------------------------------------------------------------

export type DiscoverConnectionResult =
  | { ok: true; accountLabel: string; agents: DiscoveredAgent[]; capabilities: ConnectorCapabilities }
  | { ok: false; error: string };

export async function discoverProviderConnection(
  organizationId: string,
  connectorType: ConnectorType,
  credential: string | undefined
): Promise<DiscoverConnectionResult> {
  const connector = getConnector(connectorType);

  if (connector.capabilities.credentialVerification) {
    if (!credential || credential.trim().length === 0) {
      return { ok: false, error: "Enter your API key to continue." };
    }
    const verified = await connector.verifyCredential({ organizationId, credential });
    if (!verified.ok) return { ok: false, error: verified.error };

    const agents = await connector.discoverAgents({ organizationId, credential });
    return { ok: true, accountLabel: verified.accountLabel, agents, capabilities: connector.capabilities };
  }

  return { ok: true, accountLabel: connector.displayName, agents: [], capabilities: connector.capabilities };
}

// ---------------------------------------------------------------------------
// Connect — creates the Agent + AgentConnection. Re-verifies everything
// server-side rather than trusting the discovery step's result, since a
// credential can be revoked or an assistant deleted between the two calls.
// ---------------------------------------------------------------------------

export type ConnectProviderAgentInput = {
  organizationId: string;
  userId: string;
  ownerLabel: string;
  connectorType: ConnectorType;
  credential?: string;
  selectedExternalId?: string;
  agentName?: string;
  environment?: Environment;
};

export type ConnectProviderAgentResult =
  | {
      ok: true;
      agentId: string;
      agentSlug: string;
      agentName: string;
      apiKeyRaw?: string;
      apiKeyLimitReached?: boolean;
    }
  | { ok: false; error: string }
  | { ok: false; needsSelection: true; agents: DiscoveredAgent[] };

export async function connectProviderAgent(input: ConnectProviderAgentInput): Promise<ConnectProviderAgentResult> {
  const connector = getConnector(input.connectorType);

  // Retrying "Connect" for an agent that has not made contact yet must not mint a second identity — and must not be
  // judged against the plan's agent limit, because no new agent would be created. A pending record is only a
  // placeholder until the real agent authenticates, so reuse it and issue a fresh credential for it (the unused one
  // is revoked by the reconnect). This runs BEFORE the new-agent entitlement check on purpose.
  if (input.connectorType === "CUSTOM_SDK") {
    const requestedName = input.agentName?.trim();
    if (requestedName && requestedName.length >= 2) {
      const pending = await prisma.agent.findFirst({
        where: {
          organizationId: input.organizationId,
          name: { equals: requestedName, mode: "insensitive" },
          connection: { is: { connectorType: "CUSTOM_SDK", status: "CONNECTING", firstHandshakeAt: null } },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, slug: true, name: true },
      });
      if (pending) {
        const reissued = await reconnectAgentConnection(input.organizationId, input.userId, pending.slug);
        if (!reissued.ok) return { ok: false, error: reissued.error };
        return { ok: true, agentId: pending.id, agentSlug: pending.slug, agentName: pending.name, apiKeyRaw: reissued.apiKeyRaw };
      }
    }
  }

  // Early, friendly check before any provider round trip. Not the
  // authoritative one — that's re-done under a lock inside the creating
  // transaction below (lib/agents/creation-guard.ts).
  const [agentCount, organization] = await Promise.all([
    prisma.agent.count({ where: { organizationId: input.organizationId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { plan: true } }),
  ]);
  const entitlement = canCreateAgent(organization.plan, agentCount);
  if (!entitlement.allowed) return { ok: false, error: entitlement.reason };

  let credential: string | undefined;
  let accountLabel = connector.displayName;

  if (connector.capabilities.credentialVerification) {
    credential = input.credential?.trim();
    if (!credential) return { ok: false, error: "Enter your API key to continue." };
    const verified = await connector.verifyCredential({ organizationId: input.organizationId, credential });
    if (!verified.ok) return { ok: false, error: verified.error };
    accountLabel = verified.accountLabel;
  }

  // Resolve the specific agent identity: a re-fetched, authoritative
  // provider-side record when one was selected or discoverable, or a
  // user-supplied name when discovery genuinely has nothing to offer.
  let externalAgentId: string | null = null;
  let resolvedName: string | null = null;
  let resolvedModel: string | null = null;

  if (input.selectedExternalId) {
    const discovered = await connector.getDiscoveredAgent(
      { organizationId: input.organizationId, credential },
      input.selectedExternalId
    );
    if (!discovered) {
      return { ok: false, error: "That agent could no longer be found. It may have been renamed or deleted." };
    }
    externalAgentId = discovered.externalId;
    resolvedName = discovered.name;
    resolvedModel = discovered.model ?? null;
  } else if (connector.capabilities.agentDiscovery) {
    const discovered = await connector.discoverAgents({ organizationId: input.organizationId, credential });
    if (discovered.length > 1) {
      return { ok: false, needsSelection: true, agents: discovered };
    }
    if (discovered.length === 1) {
      externalAgentId = discovered[0].externalId;
      resolvedName = discovered[0].name;
      resolvedModel = discovered[0].model ?? null;
    }
  }

  const finalName = resolvedName ?? input.agentName?.trim();
  if (!finalName || finalName.length < 2) {
    return { ok: false, error: "Enter a name for this agent." };
  }

  const slug = await ensureUniqueAgentSlug(input.organizationId, finalName);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const lockedEntitlement = await checkAgentLimitLocked(tx, input.organizationId);
      if (!lockedEntitlement.allowed) throw new AgentLimitReachedError(lockedEntitlement.reason);

      const agent = await tx.agent.create({
        data: {
          organizationId: input.organizationId,
          name: finalName,
          slug,
          owner: input.ownerLabel,
          environment: input.environment ?? "PRODUCTION",
          modelProvider: connector.displayName,
          modelName: resolvedModel ?? "unknown",
          status: "ACTIVE",
        },
      });

      let apiKeyId: string | null = null;
      let apiKeyRaw: string | undefined;
      let apiKeyLimitReached = false;

      if (input.connectorType === "CUSTOM_SDK") {
        const activeKeyCount = await apiKeyRepo.countPlanLimitedApiKeys(input.organizationId, tx);
        const keyEntitlement = canCreateApiKey(organization.plan, activeKeyCount);
        if (keyEntitlement.allowed) {
          const created = await apiKeyRepo.createApiKey(
            input.organizationId,
            input.userId,
            // Bound to this agent (P0 §7): the auto-provisioned SDK key can only act as it.
            { name: `Agent SDK — ${finalName}`, environment: input.environment === undefined || input.environment === "PRODUCTION" ? "LIVE" : "TEST", agentId: agent.id },
            tx
          );
          apiKeyId = created.apiKey.id;
          apiKeyRaw = created.raw;
        } else {
          apiKeyLimitReached = true;
        }
      }

      const connectionData: {
        credentialCiphertext?: string;
        credentialIv?: string;
        credentialAuthTag?: string;
        credentialKeyId?: string | null;
        externalAccountLabel?: string;
      } = {};
      if (credential) {
        const encrypted = encryptCredential(credential);
        connectionData.credentialCiphertext = encrypted.ciphertext;
        connectionData.credentialIv = encrypted.iv;
        connectionData.credentialAuthTag = encrypted.authTag;
        connectionData.credentialKeyId = encrypted.keyId;
        connectionData.externalAccountLabel = maskCredential(credential);
      } else {
        connectionData.externalAccountLabel = accountLabel;
      }

      await tx.agentConnection.create({
        data: {
          organizationId: input.organizationId,
          agentId: agent.id,
          connectorType: input.connectorType,
          // An Aegis-key (SDK) connection is NOT connected when its credential is issued: it is waiting until a
          // request authenticated with that credential actually reaches Aegis (lib/agents/handshake.ts).
          // A provider connection is connected in the only sense that is true at this point: the provider verified it.
          status: input.connectorType === "CUSTOM_SDK" ? "CONNECTING" : "CONNECTED",
          externalAgentId,
          apiKeyId,
          capabilities: connector.capabilities as unknown as Prisma.InputJsonValue,
          lastVerifiedAt: credential ? new Date() : null,
          createdById: input.userId,
          ...connectionData,
        },
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "USER",
        actorUserId: input.userId,
        agentId: agent.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_CONNECTED,
        entityType: "Agent",
        entityId: agent.id,
        action: "agent.connect",
        metadata: { connectorType: input.connectorType, externalAgentId: externalAgentId ?? undefined },
      });

      return { agent, apiKeyRaw, apiKeyLimitReached };
    });
  } catch (error) {
    if (error instanceof AgentLimitReachedError) return { ok: false, error: error.message };
    throw error;
  }

  await dispatchWebhookEvent(input.organizationId, "agent.connected", {
    agentId: result.agent.id,
    agentName: result.agent.name,
    connectorType: input.connectorType,
  });

  return {
    ok: true,
    agentId: result.agent.id,
    agentSlug: result.agent.slug,
    agentName: result.agent.name,
    apiKeyRaw: result.apiKeyRaw,
    apiKeyLimitReached: result.apiKeyLimitReached || undefined,
  };
}

// ---------------------------------------------------------------------------
// Health check — on demand only (no background job infrastructure exists
// in this environment; see lib/webhooks/dispatch.ts for the same
// constraint). Never claims a status it didn't just verify.
// ---------------------------------------------------------------------------

async function loadConnection(organizationId: string, agentSlug: string) {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug: agentSlug } },
    include: { connection: true },
  });
  if (!agent?.connection) throw new AgentConnectionNotFoundError();
  return { agent, connection: agent.connection };
}

type StoredCredentialFields = {
  id: string;
  credentialCiphertext: string | null;
  credentialIv: string | null;
  credentialAuthTag: string | null;
  credentialKeyId: string | null;
};

/**
 * Decrypts a stored provider credential with whichever configured key wrote
 * it (lib/connectors/crypto.ts), and — if that wasn't the current primary
 * key, or the row predates key versioning — re-encrypts it with the primary
 * key on the spot, so a key rotation converges row by row as connections are
 * used. The re-encryption only replaces the row if it still holds exactly
 * the ciphertext we decrypted (no clobbering a concurrent reconnect).
 */
export async function readConnectionSecret(connection: StoredCredentialFields): Promise<string | undefined> {
  return decryptStoredCredential(connection);
}

async function decryptStoredCredential(connection: StoredCredentialFields): Promise<string | undefined> {
  if (!connection.credentialCiphertext || !connection.credentialIv || !connection.credentialAuthTag) return undefined;
  const decrypted = decryptCredentialWithKeyInfo({
    ciphertext: connection.credentialCiphertext,
    iv: connection.credentialIv,
    authTag: connection.credentialAuthTag,
    keyId: connection.credentialKeyId,
  });

  if (decrypted.needsReencryption) {
    const reencrypted = encryptCredential(decrypted.plaintext);
    await prisma.agentConnection
      .updateMany({
        where: { id: connection.id, credentialCiphertext: connection.credentialCiphertext },
        data: {
          credentialCiphertext: reencrypted.ciphertext,
          credentialIv: reencrypted.iv,
          credentialAuthTag: reencrypted.authTag,
          credentialKeyId: reencrypted.keyId,
        },
      })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ msg: "credential_reencrypt_failed", connectionId: connection.id, error: String(error) }));
      });
  }
  return decrypted.plaintext;
}

export type CheckHealthResult = { status: string; ok: boolean; error?: string };

export async function checkConnectionHealth(organizationId: string, agentSlug: string): Promise<CheckHealthResult> {
  const { agent, connection } = await loadConnection(organizationId, agentSlug);
  if (connection.status === "DISCONNECTED") {
    return { status: connection.status, ok: false, error: "This agent is disconnected." };
  }

  const connector = getConnector(connection.connectorType);
  let credential: string | undefined;
  try {
    credential = await decryptStoredCredential(connection);
  } catch (error) {
    if (!(error instanceof CredentialDecryptionError)) throw error;
    // Unreadable with every configured key — say so precisely instead of
    // crashing, and require a reconnect (never a silent "healthy").
    await prisma.agentConnection.update({
      where: { id: connection.id },
      data: { status: "RECONNECT_REQUIRED", lastHealthCheckAt: new Date(), lastHealthError: error.message },
    });
    return { status: "RECONNECT_REQUIRED", ok: false, error: error.message };
  }
  const result = await connector.healthCheck({
    organizationId,
    credential,
    agentId: agent.id,
    externalAgentId: connection.externalAgentId,
    endpointUrl: connection.endpointUrl,
  });

  const newStatus = result.ok ? "CONNECTED" : "RECONNECT_REQUIRED";
  await prisma.agentConnection.update({
    where: { id: connection.id },
    data: {
      status: newStatus,
      lastHealthCheckAt: new Date(),
      lastHealthError: result.ok ? null : result.error,
      lastVerifiedAt: result.ok && credential ? new Date() : connection.lastVerifiedAt,
      // An endpoint connection's contact IS the verification Aegis just performed.
      ...(result.ok && connection.connectorType === "AEGIS_ENDPOINT" ? { lastSeenAt: new Date() } : {}),
    },
  });

  return { status: newStatus, ok: result.ok, error: result.ok ? undefined : result.error };
}

// ---------------------------------------------------------------------------
// Reconnect — OPENAI/ANTHROPIC take a fresh credential; CUSTOM_SDK rotates
// its API key, since there's no third-party credential to re-enter.
// ---------------------------------------------------------------------------

export type ReconnectResult = { ok: true; apiKeyRaw?: string } | { ok: false; error: string };

export async function reconnectAgentConnection(
  organizationId: string,
  userId: string,
  agentSlug: string,
  credential?: string
): Promise<ReconnectResult> {
  const { agent, connection } = await loadConnection(organizationId, agentSlug);
  const connector = getConnector(connection.connectorType);

  if (connector.capabilities.credentialVerification) {
    const trimmed = credential?.trim();
    if (!trimmed) return { ok: false, error: "Enter your API key to reconnect." };

    const verified = await connector.verifyCredential({ organizationId, credential: trimmed, endpointUrl: connection.endpointUrl });
    if (!verified.ok) return { ok: false, error: verified.error };

    if (connection.externalAgentId) {
      const stillOwned = await connector.getDiscoveredAgent({ organizationId, credential: trimmed, endpointUrl: connection.endpointUrl }, connection.externalAgentId);
      if (!stillOwned) {
        return { ok: false, error: "This key doesn't have access to the originally connected agent." };
      }
    }

    const encrypted = encryptCredential(trimmed);
    await prisma.$transaction(async (tx) => {
      await tx.agentConnection.update({
        where: { id: connection.id },
        data: {
          status: "CONNECTED",
          credentialCiphertext: encrypted.ciphertext,
          credentialIv: encrypted.iv,
          credentialAuthTag: encrypted.authTag,
          credentialKeyId: encrypted.keyId,
          externalAccountLabel: maskCredential(trimmed),
          lastVerifiedAt: new Date(),
          ...(connection.connectorType === "AEGIS_ENDPOINT" ? { lastSeenAt: new Date() } : {}),
          lastHealthError: null,
          disconnectedAt: null,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorType: "USER",
        actorUserId: userId,
        agentId: agent.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_RECONNECTED,
        entityType: "Agent",
        entityId: agent.id,
        action: "agent.reconnect",
        metadata: { connectorType: connection.connectorType },
      });
    });

    await dispatchWebhookEvent(organizationId, "agent.reconnected", { agentId: agent.id, agentName: agent.name });
    return { ok: true };
  }

  // CUSTOM_SDK: nothing to re-verify externally — reconnecting means
  // issuing a fresh Aegis API key and revoking the old one.
  const [organization, activeKeyCount] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true } }),
    apiKeyRepo.countPlanLimitedApiKeys(organizationId),
  ]);
  const entitlement = canCreateApiKey(organization.plan, activeKeyCount);
  if (!entitlement.allowed) return { ok: false, error: entitlement.reason };

  const raw = await prisma.$transaction(async (tx) => {
    if (connection.apiKeyId) {
      await apiKeyRepo.revokeApiKey(organizationId, connection.apiKeyId, tx);
    }
    const created = await apiKeyRepo.createApiKey(
      organizationId,
      userId,
      { name: `Agent SDK — ${agent.name}`, environment: "LIVE", agentId: agent.id },
      tx
    );

    await tx.agentConnection.update({
      where: { id: connection.id },
      data: {
        // The new credential has not been used yet, so this is waiting again until it makes contact.
        // History (firstHandshakeAt, activity, trust, baselines) is untouched: the identity is preserved.
        status: "CONNECTING",
        apiKeyId: created.apiKey.id,
        lastHealthError: null,
        disconnectedAt: null,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: userId,
      agentId: agent.id,
      eventType: AUDIT_EVENT_TYPES.AGENT_RECONNECTED,
      entityType: "Agent",
      entityId: agent.id,
      action: "agent.reconnect",
      metadata: { connectorType: connection.connectorType },
    });
    return created.raw;
  });

  await dispatchWebhookEvent(organizationId, "agent.reconnected", { agentId: agent.id, agentName: agent.name });
  return { ok: true, apiKeyRaw: raw };
}

// ---------------------------------------------------------------------------
// Disconnect — stops ingestion and discards Aegis's copy of the credential.
// Never deletes historical Agent/ActivityEvent data.
// ---------------------------------------------------------------------------

export async function disconnectAgentConnection(organizationId: string, userId: string, agentSlug: string): Promise<void> {
  const { agent, connection } = await loadConnection(organizationId, agentSlug);

  await prisma.$transaction(async (tx) => {
    if (connection.apiKeyId) {
      await apiKeyRepo.revokeApiKey(organizationId, connection.apiKeyId, tx);
    }
    await tx.agentConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: new Date(),
        credentialCiphertext: null,
        credentialIv: null,
        credentialAuthTag: null,
        credentialKeyId: null,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: userId,
      agentId: agent.id,
      eventType: AUDIT_EVENT_TYPES.AGENT_DISCONNECTED,
      entityType: "Agent",
      entityId: agent.id,
      action: "agent.disconnect",
      metadata: { connectorType: connection.connectorType },
    });
  });

  await dispatchWebhookEvent(organizationId, "agent.disconnected", { agentId: agent.id, agentName: agent.name });
}
