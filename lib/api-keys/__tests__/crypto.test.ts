import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "@/lib/api-keys/crypto";

describe("generateApiKey", () => {
  it("produces a raw key matching the aegis_{env}_{secret} format", () => {
    const { raw } = generateApiKey("LIVE");
    expect(raw).toMatch(/^aegis_live_[A-Za-z0-9_-]{20,}$/);
  });

  it("uses the test environment label for TEST keys", () => {
    const { raw, prefix } = generateApiKey("TEST");
    expect(raw.startsWith("aegis_test_")).toBe(true);
    expect(prefix.startsWith("aegis_test_")).toBe(true);
  });

  it("never generates the same raw key twice", () => {
    const a = generateApiKey("LIVE");
    const b = generateApiKey("LIVE");
    expect(a.raw).not.toBe(b.raw);
  });

  it("derives prefix as a truncated, non-reversible-to-secret slice of the raw key", () => {
    const { raw, prefix } = generateApiKey("LIVE");
    expect(raw.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(raw.length);
  });

  it("hashes to a 64-char hex sha256 digest", () => {
    const { raw, keyHash } = generateApiKey("LIVE");
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(keyHash).toBe(hashApiKey(raw));
  });
});

describe("hashApiKey", () => {
  it("is deterministic", () => {
    expect(hashApiKey("aegis_live_abc")).toBe(hashApiKey("aegis_live_abc"));
  });

  it("differs for different inputs", () => {
    expect(hashApiKey("aegis_live_abc")).not.toBe(hashApiKey("aegis_live_abd"));
  });
});

describe("looksLikeApiKey", () => {
  it("accepts a well-formed key", () => {
    const { raw } = generateApiKey("LIVE");
    expect(looksLikeApiKey(raw)).toBe(true);
  });

  it("rejects obviously malformed values", () => {
    expect(looksLikeApiKey("not-a-key")).toBe(false);
    expect(looksLikeApiKey("aegis_live_")).toBe(false);
    expect(looksLikeApiKey("aegis_prod_abcdefghijklmnopqrstu")).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
  });
});
