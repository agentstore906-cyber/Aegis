/**
 * P0 §10 — provider credential encryption key rotation. Exercises the
 * supported rotation flows end to end against the real keyring logic
 * (process.env is the configuration surface, restored after each test).
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialDecryptionError,
  CredentialKeyConfigError,
  decryptCredential,
  decryptCredentialWithKeyInfo,
  encryptCredential,
  primaryCredentialKeyId,
} from "@/lib/connectors/crypto";

const SECRET = "sk-test-credential-1234567890";
const ENV_KEYS = ["AUTH_SECRET", "AUTH_SECRET_PREVIOUS", "CONNECTOR_ENCRYPTION_KEYS"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.AUTH_SECRET = "auth-secret-one-0123456789abcdef0123456789";
  delete process.env.AUTH_SECRET_PREVIOUS;
  delete process.env.CONNECTOR_ENCRYPTION_KEYS;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const newKey = () => randomBytes(32).toString("base64");

describe("AES-256-GCM is unchanged", () => {
  it("round-trips, uses a fresh IV per encryption, and never stores the plaintext", () => {
    const a = encryptCredential(SECRET);
    const b = encryptCredential(SECRET);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain(SECRET);
    expect(decryptCredential(a)).toBe(SECRET);
  });

  it("detects tampering instead of returning garbage", () => {
    const encrypted = encryptCredential(SECRET);
    const tampered = { ...encrypted, ciphertext: Buffer.from("x".repeat(20)).toString("base64") };
    expect(() => decryptCredential(tampered)).toThrow(CredentialDecryptionError);
  });
});

describe("rotating AUTH_SECRET (no dedicated keyring)", () => {
  it("before P0 this made credentials unreadable; with AUTH_SECRET_PREVIOUS they still decrypt and are flagged for re-encryption", () => {
    const encrypted = encryptCredential(SECRET);
    expect(encrypted.keyId).toMatch(/^as-[0-9a-f]{8}$/);

    process.env.AUTH_SECRET = "auth-secret-two-0123456789abcdef0123456789";
    expect(() => decryptCredential(encrypted)).toThrow(CredentialDecryptionError);

    process.env.AUTH_SECRET_PREVIOUS = "auth-secret-one-0123456789abcdef0123456789";
    const decrypted = decryptCredentialWithKeyInfo(encrypted);
    expect(decrypted.plaintext).toBe(SECRET);
    expect(decrypted.needsReencryption).toBe(true);

    // Re-encrypting moves it to the new primary; the old secret is then no longer needed.
    const reencrypted = encryptCredential(decrypted.plaintext);
    delete process.env.AUTH_SECRET_PREVIOUS;
    expect(decryptCredentialWithKeyInfo(reencrypted)).toMatchObject({ plaintext: SECRET, needsReencryption: false });
  });

  it("decrypts pre-P0 rows (keyId null) with the current or a previous AUTH_SECRET", () => {
    const legacy = { ...encryptCredential(SECRET), keyId: null };
    expect(decryptCredentialWithKeyInfo(legacy)).toMatchObject({ plaintext: SECRET, needsReencryption: true });

    process.env.AUTH_SECRET = "auth-secret-two-0123456789abcdef0123456789";
    process.env.AUTH_SECRET_PREVIOUS = "auth-secret-one-0123456789abcdef0123456789";
    expect(decryptCredential(legacy)).toBe(SECRET);
  });

  it("gives an actionable error (and no key material) when nothing configured can decrypt", () => {
    const legacy = { ...encryptCredential(SECRET), keyId: null };
    process.env.AUTH_SECRET = "auth-secret-two-0123456789abcdef0123456789";
    expect(() => decryptCredential(legacy)).toThrow(/AUTH_SECRET_PREVIOUS/);
  });
});

describe("dedicated CONNECTOR_ENCRYPTION_KEYS", () => {
  it("makes AUTH_SECRET rotation irrelevant to stored credentials", () => {
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${newKey()}`;
    const encrypted = encryptCredential(SECRET);
    expect(encrypted.keyId).toBe("k1");

    process.env.AUTH_SECRET = "a-completely-different-auth-secret-0123456789";
    expect(decryptCredential(encrypted)).toBe(SECRET);
  });

  it("supports key rotation: new primary encrypts, old key still decrypts until re-encrypted", () => {
    const k1 = newKey();
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${k1}`;
    const old = encryptCredential(SECRET);

    process.env.CONNECTOR_ENCRYPTION_KEYS = `k2:${newKey()},k1:${k1}`;
    expect(primaryCredentialKeyId()).toBe("k2");
    expect(decryptCredentialWithKeyInfo(old)).toMatchObject({ plaintext: SECRET, keyId: "k1", needsReencryption: true });
    expect(encryptCredential(SECRET).keyId).toBe("k2");
  });

  it("migrates pre-P0 AUTH_SECRET-encrypted rows onto the dedicated key", () => {
    const legacy = { ...encryptCredential(SECRET), keyId: null };
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${newKey()}`;
    const decrypted = decryptCredentialWithKeyInfo(legacy);
    expect(decrypted).toMatchObject({ plaintext: SECRET, needsReencryption: true });
    expect(encryptCredential(decrypted.plaintext).keyId).toBe("k1");
  });

  it("refuses to decrypt with a key id that isn't configured, explaining how to fix it", () => {
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${newKey()}`;
    const encrypted = encryptCredential(SECRET);
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k2:${newKey()}`;
    expect(() => decryptCredential(encrypted)).toThrow(/"k1", which is not configured/);
  });

  it("rejects malformed key configuration loudly rather than weakening encryption", () => {
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${Buffer.from("too-short").toString("base64")}`;
    expect(() => encryptCredential(SECRET)).toThrow(CredentialKeyConfigError);
    process.env.CONNECTOR_ENCRYPTION_KEYS = `no-separator`;
    expect(() => encryptCredential(SECRET)).toThrow(CredentialKeyConfigError);
    const key = newKey();
    process.env.CONNECTOR_ENCRYPTION_KEYS = `k1:${key},k1:${key}`;
    expect(() => encryptCredential(SECRET)).toThrow(CredentialKeyConfigError);
  });
});
