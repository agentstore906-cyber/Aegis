import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Encrypts provider credentials (OpenAI/Anthropic secret API keys) at rest.
 * Unlike lib/api-keys/crypto.ts (one-way hash — Aegis never needs the raw
 * value back), a connector has to present the *original* credential to the
 * provider's API on every health check and reconnect, so this has to be
 * reversible. AES-256-GCM, with a key derived from AUTH_SECRET (already a
 * required, high-entropy, server-only secret — see lib/env.ts) via scrypt,
 * rather than requiring a brand-new environment variable for this one
 * feature. Never used for anything Aegis itself generates (webhook
 * secrets, API keys) — those stay one-way hashed, unchanged.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_INFO = "aegis-connector-credentials-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(env.AUTH_SECRET, KEY_INFO, 32);
  }
  return cachedKey;
}

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptCredential(raw: string): EncryptedCredential {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCredential(encrypted: EncryptedCredential): string {
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const raw = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]);
  return raw.toString("utf8");
}

/**
 * A display-only masked form of a secret key, e.g. "sk-...ab12" — safe to
 * store as AgentConnection.externalAccountLabel and render in the UI.
 * Never derived from or reversible to the original value beyond what's
 * already visible in the mask.
 */
export function maskCredential(raw: string): string {
  const visible = raw.slice(-4);
  const dashIndex = raw.indexOf("-");
  const prefix = dashIndex > 0 && dashIndex <= 12 ? raw.slice(0, dashIndex + 1) : raw.slice(0, 3);
  return `${prefix}...${visible}`;
}
