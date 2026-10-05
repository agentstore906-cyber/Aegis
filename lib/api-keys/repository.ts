import "server-only";

import type { ApiKeyEnvironment } from "@prisma/client";

import { prisma, type PrismaOrTx } from "@/lib/db";
import { generateApiKey, hashApiKey } from "@/lib/api-keys/crypto";
import { AdminScopeOnBoundKeyError, scopesForNewKey } from "@/lib/api-keys/scopes";

export type CreateApiKeyInput = {
  name: string;
  environment: ApiKeyEnvironment;
  expiresAt?: Date | null;
  /** Bind the key to one agent (P0 §7). Caller must have verified the agent belongs to organizationId. */
  agentId?: string | null;
  /** Opt-in tooling scopes (policy simulation, agent inventory). Organization-wide keys only. */
  adminAccess?: boolean;
};

export async function listApiKeys(organizationId: string) {
  return prisma.apiKey.findMany({
    where: { organizationId },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Active keys that count against the plan's API-key limit.
 *
 * A credential that Connect Agent issued for an agent (the one an AgentConnection points at) IS that agent's
 * identity: it is limited by the plan's agent limit, not by the developer-key limit. Counting it here made the
 * Nth agent on every limited plan (Free: 3 agents but 2 keys) impossible to connect — the agent was created
 * with no credential and could never authenticate.
 */
export async function countPlanLimitedApiKeys(organizationId: string, client: PrismaOrTx = prisma): Promise<number> {
  return client.apiKey.count({ where: { organizationId, revokedAt: null, agentConnections: { none: {} } } });
}

export async function getApiKey(organizationId: string, id: string) {
  return prisma.apiKey.findFirst({ where: { id, organizationId } });
}

/** Creates a key and returns both the persisted row and the one-time raw secret. */
export async function createApiKey(
  organizationId: string,
  createdById: string | null,
  input: CreateApiKeyInput,
  client: PrismaOrTx = prisma
) {
  const { raw, prefix, keyHash } = generateApiKey(input.environment);

  // Admin scopes (simulation, inventory) are for organization-wide tooling keys only.
  if (input.adminAccess && input.agentId) throw new AdminScopeOnBoundKeyError();

  const apiKey = await client.apiKey.create({
    data: {
      organizationId,
      createdById,
      name: input.name,
      environment: input.environment,
      prefix,
      keyHash,
      expiresAt: input.expiresAt ?? undefined,
      agentId: input.agentId ?? undefined,
      // Unset = the database default (the agent-facing scopes); admin access adds the opt-in scopes explicitly.
      ...(input.adminAccess ? { scopes: scopesForNewKey({ adminAccess: true }) } : {}),
    },
  });

  return { apiKey, raw };
}

export async function revokeApiKey(organizationId: string, id: string, client: PrismaOrTx = prisma) {
  const result = await client.apiKey.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** The authentication lookup path — a direct unique-index hit on keyHash, org-independent by design (the org comes back with the row). */
export async function findActiveApiKeyByRawKey(rawKey: string) {
  return prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    include: { organization: true },
  });
}

/**
 * Fire-and-forget update — callers should not `await` this on the
 * request's critical path. Failure to record a "last used" timestamp is
 * never a reason to fail or slow down the caller's actual request.
 */
export function touchLastUsed(id: string): void {
  prisma.apiKey
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ msg: "api_key_touch_last_used_failed", apiKeyId: id, error: String(error) }));
    });
}
