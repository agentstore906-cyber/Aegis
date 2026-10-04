import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * (Implementation module — import from lib/connectors/crypto.ts in app code.
 * Kept free of `server-only`/env imports so scripts/rotate-connector-
 * credentials.ts can use the exact same keyring under plain tsx.)
 *
 * Encrypts provider credentials (OpenAI/Anthropic secret API keys) at rest.
 * Unlike lib/api-keys/crypto.ts (one-way hash — Aegis never needs the raw
 * value back), a connector has to present the *original* credential to the
 * provider's API on every health check and reconnect, so this has to be
 * reversible. AES-256-GCM with a random 96-bit IV per value; unchanged by P0.
 *
 * KEY VERSIONING (P0 — docs/AEGIS_P0_IMPLEMENTATION.md §10). Every
 * ciphertext now records the id of the key that produced it
 * (AgentConnection.credentialKeyId), and decryption looks the key up by id
 * in a keyring, so the encryption key can change without making stored
 * credentials unreadable:
 *
 *   CONNECTOR_ENCRYPTION_KEYS  "id:base64key[,id:base64key...]" — dedicated
 *                              keys (32 random bytes each). The FIRST is the
 *                              primary used for new encryptions; the rest
 *                              stay decrypt-only until rows are re-encrypted
 *                              (scripts/rotate-connector-credentials.ts).
 *   AUTH_SECRET                Fallback primary when no dedicated key is
 *                              configured (the pre-P0 behavior): key =
 *                              scrypt(AUTH_SECRET, "aegis-connector-
 *                              credentials-v1"), id = "as-" + 8 hex chars of
 *                              a hash of that derived key.
 *   AUTH_SECRET_PREVIOUS       Comma-separated former AUTH_SECRET values,
 *                              decrypt-only — set this when rotating
 *                              AUTH_SECRET so existing credentials still
 *                              decrypt (and get re-encrypted) afterwards.
 *
 * Rows written before P0 have credentialKeyId = null; they were always
 * encrypted with an AUTH_SECRET-derived key, so decryption tries the current
 * and every previous AUTH_SECRET. GCM's auth tag makes a wrong key fail
 * loudly — never a silent garbage decrypt.
 *
 * Recommended: configure CONNECTOR_ENCRYPTION_KEYS so rotating the session
 * secret (AUTH_SECRET) and rotating credential encryption are independent.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_INFO = "aegis-connector-credentials-v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  /** Id of the key that encrypted this value. null = pre-P0 row (AUTH_SECRET-derived). */
  keyId: string | null;
};

type KeyringEntry = { id: string; key: Buffer; source: "dedicated" | "auth_secret" | "auth_secret_previous" };

export class CredentialKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialKeyConfigError";
  }
}

export class CredentialDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialDecryptionError";
  }
}

function deriveFromAuthSecret(secret: string): Buffer {
  return scryptSync(secret, KEY_INFO, 32);
}

function authSecretKeyId(key: Buffer): string {
  return `as-${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

let cache: { signature: string; keyring: KeyringEntry[] } | null = null;

/** Builds (and memoizes per configuration) the ordered keyring. Primary first. */
function getKeyring(): KeyringEntry[] {
  const dedicatedRaw = process.env.CONNECTOR_ENCRYPTION_KEYS ?? "";
  const previousRaw = process.env.AUTH_SECRET_PREVIOUS ?? "";
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) throw new CredentialKeyConfigError("AUTH_SECRET is not set (see lib/env.ts).");
  const signature = createHash("sha256").update(`${dedicatedRaw}\u0000${previousRaw}\u0000${authSecret}`).digest("hex");
  if (cache?.signature === signature) return cache.keyring;

  const keyring: KeyringEntry[] = [];
  const seen = new Set<string>();

  for (const part of dedicatedRaw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const separator = part.indexOf(":");
    const id = separator > 0 ? part.slice(0, separator) : "";
    const material = separator > 0 ? part.slice(separator + 1) : "";
    if (!KEY_ID_PATTERN.test(id) || id.startsWith("as-")) {
      throw new CredentialKeyConfigError(
        'CONNECTOR_ENCRYPTION_KEYS entries must look like "<id>:<base64 32-byte key>" with an id of 1-32 letters, digits, "-" or "_" (not starting with "as-").'
      );
    }
    const key = Buffer.from(material, "base64");
    if (key.length !== 32) {
      throw new CredentialKeyConfigError(
        `CONNECTOR_ENCRYPTION_KEYS key "${id}" must decode to exactly 32 bytes (generate with \`openssl rand -base64 32\`).`
      );
    }
    if (seen.has(id)) throw new CredentialKeyConfigError(`CONNECTOR_ENCRYPTION_KEYS has duplicate key id "${id}".`);
    seen.add(id);
    keyring.push({ id, key, source: "dedicated" });
  }

  const authKey = deriveFromAuthSecret(authSecret);
  keyring.push({ id: authSecretKeyId(authKey), key: authKey, source: "auth_secret" });

  for (const previous of previousRaw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const key = deriveFromAuthSecret(previous);
    const id = authSecretKeyId(key);
    if (keyring.some((entry) => entry.id === id)) continue;
    keyring.push({ id, key, source: "auth_secret_previous" });
  }

  cache = { signature, keyring };
  return keyring;
}

/** The key id new encryptions use. */
export function primaryCredentialKeyId(): string {
  return getKeyring()[0].id;
}

export function encryptCredential(raw: string): EncryptedCredential {
  const primary = getKeyring()[0];
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, primary.key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyId: primary.id,
  };
}

function tryDecrypt(key: Buffer, encrypted: EncryptedCredential): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64"));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type DecryptedCredential = {
  plaintext: string;
  /** Key that actually decrypted it. */
  keyId: string;
  /** True when it wasn't the primary key (or was a legacy unversioned row) — re-encrypt with encryptCredential(). */
  needsReencryption: boolean;
};

/**
 * Decrypts with the key named by `keyId`; for legacy rows (keyId null),
 * tries each AUTH_SECRET-derived key (current, then previous). Throws
 * CredentialDecryptionError — with an actionable message, never key
 * material — when no configured key can decrypt it.
 */
export function decryptCredentialWithKeyInfo(encrypted: EncryptedCredential): DecryptedCredential {
  const keyring = getKeyring();
  const primaryId = keyring[0].id;

  const candidates =
    encrypted.keyId === null
      ? keyring.filter((entry) => entry.source !== "dedicated")
      : keyring.filter((entry) => entry.id === encrypted.keyId);

  if (candidates.length === 0) {
    throw new CredentialDecryptionError(
      `This credential was encrypted with key "${encrypted.keyId}", which is not configured. Restore that key in CONNECTOR_ENCRYPTION_KEYS (or its AUTH_SECRET in AUTH_SECRET_PREVIOUS), or reconnect the agent with a fresh credential.`
    );
  }

  for (const entry of candidates) {
    const plaintext = tryDecrypt(entry.key, encrypted);
    if (plaintext !== null) {
      return { plaintext, keyId: entry.id, needsReencryption: encrypted.keyId === null || entry.id !== primaryId };
    }
  }

  throw new CredentialDecryptionError(
    encrypted.keyId === null
      ? "This credential predates key versioning and could not be decrypted with the current AUTH_SECRET or any AUTH_SECRET_PREVIOUS value. If AUTH_SECRET was rotated, add the old value to AUTH_SECRET_PREVIOUS; otherwise reconnect the agent."
      : `This credential could not be decrypted with key "${encrypted.keyId}" — the configured key material does not match. Restore the original key or reconnect the agent.`
  );
}

/** Convenience wrapper returning only the plaintext. */
export function decryptCredential(encrypted: EncryptedCredential): string {
  return decryptCredentialWithKeyInfo(encrypted).plaintext;
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
