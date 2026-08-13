import "server-only";

import { randomBytes, createHash } from "node:crypto";
import type { ApiKeyEnvironment } from "@prisma/client";

/**
 * API keys are high-entropy random secrets, not human passwords — there is
 * no meaningful brute-force risk to slow down, so hashing with SHA-256
 * (fast, deterministic) is the right tool here, unlike the deliberately
 * slow bcrypt used for user passwords in lib/auth/password.ts. A fast hash
 * also lets authentication do a direct unique-index lookup by keyHash
 * instead of needing a prefix-narrowing step first.
 */
const SECRET_BYTES = 24; // ~144 bits of entropy, base64url-encoded below
const PREFIX_VISIBLE_CHARS = 8;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function environmentLabel(environment: ApiKeyEnvironment): "live" | "test" {
  return environment === "LIVE" ? "live" : "test";
}

/**
 * Generates a new raw API key plus its derived, storable fields. The raw
 * value is returned once — callers must show it to the user immediately
 * and never persist it themselves; only `keyHash` is stored.
 */
export function generateApiKey(environment: ApiKeyEnvironment): {
  raw: string;
  prefix: string;
  keyHash: string;
} {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const raw = `aegis_${environmentLabel(environment)}_${secret}`;
  const prefix = `aegis_${environmentLabel(environment)}_${secret.slice(0, PREFIX_VISIBLE_CHARS)}`;

  return { raw, prefix, keyHash: hashApiKey(raw) };
}

const KEY_PATTERN = /^aegis_(live|test)_[A-Za-z0-9_-]{20,}$/;

/** Cheap shape check before spending a database round trip on an obviously-malformed key. */
export function looksLikeApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}
