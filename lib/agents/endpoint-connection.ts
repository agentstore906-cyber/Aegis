import "server-only";

import { Prisma } from "@prisma/client";
import type { Environment } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureUniqueAgentSlug } from "@/lib/agents/queries";
import { AgentLimitReachedError, checkAgentLimitLocked } from "@/lib/agents/creation-guard";
import { endpointConnector } from "@/lib/connectors/endpoint";
import { contactAgent, EndpointError, type EndpointFailureCode } from "@/lib/connectors/endpoint-client";
import { normalizeEndpointUrl } from "@/lib/connectors/endpoint-protocol";
import { encryptCredential, maskCredential } from "@/lib/connectors/crypto";
import { canCreateAgent } from "@/lib/billing/entitlements";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";

/**
 * Connect an external agent: Aegis CONNECTS TO it (aegis-agent/1). Nothing is created until the agent has answered a
 * fresh signed challenge with a valid proof. A failed attempt leaves no Agent, no connection and no credential behind,
 * so there is never a "connected" agent that was not reached.
 *
 * Identity: the agent's own id, proven with the shared secret, is pinned on the connection (`externalAgentId`).
 * Neither the name the user types nor a slug is identity. The same real agent cannot be connected twice in one
 * organization — not by URL, and not by id through a different URL.
 */

export type ConnectEndpointResult =
  | { ok: true; agentId: string; agentSlug: string; agentName: string; verifiedAt: Date; reconnected: boolean }
  | { ok: false; code: EndpointFailureCode | "PLAN_LIMIT" | "DUPLICATE" | "IDENTITY_CHANGED" | "INVALID"; error: string };

export async function connectEndpointAgent(input: {
  organizationId: string;
  userId: string;
  ownerLabel: string;
  endpointUrl: string;
  secret: string;
  displayName?: string;
  environment?: Environment;
}): Promise<ConnectEndpointResult> {
  const normalized = normalizeEndpointUrl(input.endpointUrl);
  if (!normalized.ok) return { ok: false, code: "INVALID", error: normalized.message };
  const endpointUrl = normalized.normalized;

  // 1. The real connection test. Everything below happens only if the agent answered.
  let agent;
  try {
    agent = await contactAgent(endpointUrl, input.secret, "verify");
  } catch (error) {
    if (error instanceof EndpointError) return { ok: false, code: error.code, error: error.message };
    throw error;
  }
  const verifiedAt = new Date();

  // 2. The same endpoint already connected in this organization: re-verify only, never a second identity.
  const existing = await prisma.agentConnection.findFirst({
    where: { organizationId: input.organizationId, connectorType: "AEGIS_ENDPOINT", OR: [{ endpointUrl }, { externalAgentId: agent.id }] },
    include: { agent: { select: { id: true, slug: true, name: true } } },
  });
  if (existing) {
    if (existing.endpointUrl !== endpointUrl) {
      return { ok: false, code: "DUPLICATE", error: `This agent is already connected as "${existing.agent.name}" through a different endpoint.` };
    }
    if (existing.externalAgentId !== agent.id) {
      return { ok: false, code: "IDENTITY_CHANGED", error: "A different agent now answers at this endpoint. Aegis will not treat it as the agent connected before." };
    }
    const enc = encryptCredential(input.secret);
    const wasConnected = existing.status === "CONNECTED";
    await prisma.agentConnection.update({
      where: { id: existing.id },
      data: {
        status: "CONNECTED",
        credentialCiphertext: enc.ciphertext,
        credentialIv: enc.iv,
        credentialAuthTag: enc.authTag,
        credentialKeyId: enc.keyId,
        externalAccountLabel: maskCredential(input.secret),
        lastVerifiedAt: verifiedAt,
        lastSeenAt: verifiedAt,
        lastHealthError: null,
        disconnectedAt: null,
      },
    });
    if (!wasConnected) {
      await recordAuditEvent(prisma, {
        organizationId: input.organizationId,
        actorType: "USER",
        actorUserId: input.userId,
        agentId: existing.agent.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_RECONNECTED,
        entityType: "Agent",
        entityId: existing.agent.id,
        action: "agent.reconnect",
        metadata: { connectorType: "AEGIS_ENDPOINT" },
      });
    }
    return { ok: true, agentId: existing.agent.id, agentSlug: existing.agent.slug, agentName: existing.agent.name, verifiedAt, reconnected: true };
  }

  // 3. A new real agent. The friendly check first; the authoritative one is under a lock inside the transaction.
  const [agentCount, organization] = await Promise.all([
    prisma.agent.count({ where: { organizationId: input.organizationId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { plan: true } }),
  ]);
  const entitlement = canCreateAgent(organization.plan, agentCount);
  if (!entitlement.allowed) return { ok: false, code: "PLAN_LIMIT", error: entitlement.reason };

  const name = input.displayName?.trim() || agent.name;
  const slug = await ensureUniqueAgentSlug(input.organizationId, name);
  const enc = encryptCredential(input.secret);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const locked = await checkAgentLimitLocked(tx, input.organizationId);
      if (!locked.allowed) throw new AgentLimitReachedError(locked.reason);
      const row = await tx.agent.create({
        data: {
          organizationId: input.organizationId,
          name,
          slug,
          owner: input.ownerLabel,
          environment: input.environment ?? "PRODUCTION",
          modelProvider: "External agent",
          modelName: "unknown",
          status: "ACTIVE",
        },
      });
      await tx.agentConnection.create({
        data: {
          organizationId: input.organizationId,
          agentId: row.id,
          connectorType: "AEGIS_ENDPOINT",
          status: "CONNECTED",
          endpointUrl,
          externalAgentId: agent.id,
          externalAccountLabel: maskCredential(input.secret),
          credentialCiphertext: enc.ciphertext,
          credentialIv: enc.iv,
          credentialAuthTag: enc.authTag,
          credentialKeyId: enc.keyId,
          capabilities: endpointConnector.capabilities as unknown as Prisma.InputJsonValue,
          lastVerifiedAt: verifiedAt,
          // Contact evidence for an endpoint connection IS this verification: Aegis reached the agent.
          firstHandshakeAt: verifiedAt,
          lastSeenAt: verifiedAt,
          createdById: input.userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorType: "USER",
        actorUserId: input.userId,
        agentId: row.id,
        eventType: AUDIT_EVENT_TYPES.AGENT_CONNECTED,
        entityType: "Agent",
        entityId: row.id,
        action: "agent.connect",
        metadata: { connectorType: "AEGIS_ENDPOINT", endpointHost: new URL(endpointUrl).host },
      });
      return row;
    });
    await dispatchWebhookEvent(input.organizationId, "agent.connected", { agentId: created.id, agentName: created.name, connectorType: "AEGIS_ENDPOINT" });
    return { ok: true, agentId: created.id, agentSlug: created.slug, agentName: created.name, verifiedAt, reconnected: false };
  } catch (error) {
    if (error instanceof AgentLimitReachedError) return { ok: false, code: "PLAN_LIMIT", error: error.message };
    // Two concurrent connects of the same endpoint/agent: the unique constraint makes exactly one win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, code: "DUPLICATE", error: "This agent was just connected. Open it from your agents list." };
    }
    throw error;
  }
}
