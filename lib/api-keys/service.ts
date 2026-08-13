import "server-only";

import { findActiveApiKeyByRawKey, touchLastUsed } from "@/lib/api-keys/repository";
import { looksLikeApiKey } from "@/lib/api-keys/crypto";
import {
  ExpiredApiKeyError,
  InsufficientScopeError,
  InvalidApiKeyError,
  MissingApiKeyError,
  RevokedApiKeyError,
} from "@/lib/api-keys/types";

/**
 * Parses `Authorization: Bearer <key>`, authenticates it, and returns the
 * owning organization + key row. This is the one place external API
 * routes trust an organization identity from — never from a client-
 * supplied organizationId or agent id. Updates lastUsedAt without
 * blocking the response.
 */
export async function authenticateApiKey(authorizationHeader: string | null) {
  if (!authorizationHeader) throw new MissingApiKeyError();

  const [scheme, rawKey] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !rawKey) throw new MissingApiKeyError();
  if (!looksLikeApiKey(rawKey)) throw new InvalidApiKeyError();

  const apiKey = await findActiveApiKeyByRawKey(rawKey);
  if (!apiKey) throw new InvalidApiKeyError();
  if (apiKey.revokedAt) throw new RevokedApiKeyError();
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) throw new ExpiredApiKeyError();

  touchLastUsed(apiKey.id);

  return { organization: apiKey.organization, apiKey };
}

export function requireScope(scopes: string[], required: string): void {
  if (!scopes.includes(required)) throw new InsufficientScopeError(required);
}
