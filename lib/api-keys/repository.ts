import "server-only";

import type { ApiKeyEnvironment } from "@prisma/client";

import { prisma, type PrismaOrTx } from "@/lib/db";
import { generateApiKey, hashApiKey } from "@/lib/api-keys/crypto";

export type CreateApiKeyInput = {
  name: string;
  environment: ApiKeyEnvironment;
  expiresAt?: Date | null;
};

export async function listApiKeys(organizationId: string) {
  return prisma.apiKey.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
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

  const apiKey = await client.apiKey.create({
    data: {
      organizationId,
      createdById,
      name: input.name,
      environment: input.environment,
      prefix,
      keyHash,
      expiresAt: input.expiresAt ?? undefined,
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
