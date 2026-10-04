import "server-only";

import { createHash, createHmac, scryptSync } from "node:crypto";

/**
 * End-user pseudonymization (P1 — docs/AEGIS_P1_DATA_FOUNDATION.md "Privacy").
 *
 * Agents may report which end user they acted for (`endUserId`). Aegis never
 * stores that raw id (it's often an email). It stores
 *   "<keyId>:<first 32 hex chars of HMAC-SHA256(key, organizationId \0 endUserId)>"
 * which is:
 *   - stable per (organization, user) — "normal users" can be baselined later;
 *   - organization-scoped — the same user in two orgs yields unrelated values;
 *   - keyed — unlike a plain hash, low-entropy ids (emails) can't be recovered
 *     by guessing without the key.
 *
 * Key: TELEMETRY_HASH_KEY (base64, >= 32 bytes) when set, otherwise derived
 * from AUTH_SECRET. The key id prefix records which key produced a value, so
 * a key change is visible in the data (pseudonyms under a new key don't
 * match old ones — a continuity loss, never an exposure). Prefer setting a
 * dedicated TELEMETRY_HASH_KEY so rotating AUTH_SECRET doesn't reset it.
 */
const DERIVATION_LABEL = "aegis-telemetry-pseudonym-v1";

let cache: { signature: string; key: Buffer; keyId: string } | null = null;

function getKey(): { key: Buffer; keyId: string } {
  const dedicated = process.env.TELEMETRY_HASH_KEY ?? "";
  const authSecret = process.env.AUTH_SECRET ?? "";
  const signature = createHash("sha256").update(`${dedicated}\u0000${authSecret}`).digest("hex");
  if (cache?.signature === signature) return cache;

  let key: Buffer;
  let prefix: string;
  if (dedicated) {
    key = Buffer.from(dedicated, "base64");
    if (key.length < 32) throw new Error("TELEMETRY_HASH_KEY must decode to at least 32 bytes (openssl rand -base64 32).");
    prefix = "tk";
  } else {
    if (!authSecret) throw new Error("AUTH_SECRET is not set (see lib/env.ts).");
    key = scryptSync(authSecret, DERIVATION_LABEL, 32);
    prefix = "as";
  }
  const keyId = `${prefix}${createHash("sha256").update(key).digest("hex").slice(0, 6)}`;
  cache = { signature, key, keyId };
  return cache;
}

export function pseudonymizeEndUser(organizationId: string, endUserId: string): string {
  const { key, keyId } = getKey();
  const digest = createHmac("sha256", key).update(`${organizationId}\u0000${endUserId.trim()}`).digest("hex");
  return `${keyId}:${digest.slice(0, 32)}`;
}
