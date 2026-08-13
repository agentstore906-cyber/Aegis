import { describe, expect, it } from "vitest";
import { generateWebhookSecret, signPayload } from "@/lib/webhooks/crypto";
import { assertSafeWebhookUrl, isPrivateOrReservedIp, UnsafeWebhookUrlError } from "@/lib/webhooks/ssrf";

describe("generateWebhookSecret", () => {
  it("produces a whsec_-prefixed value", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{20,}$/);
  });

  it("never generates the same secret twice", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("signPayload", () => {
  it("is deterministic for the same secret and body", () => {
    expect(signPayload("secret", '{"a":1}')).toBe(signPayload("secret", '{"a":1}'));
  });

  it("produces a 64-char hex digest", () => {
    expect(signPayload("secret", "body")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs when the secret differs", () => {
    expect(signPayload("secret-a", "body")).not.toBe(signPayload("secret-b", "body"));
  });

  it("differs when the body differs", () => {
    expect(signPayload("secret", "body-a")).not.toBe(signPayload("secret", "body-b"));
  });
});

describe("isPrivateOrReservedIp", () => {
  it("flags loopback, private, link-local, and multicast IPv4 ranges", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("224.0.0.1")).toBe(true);
  });

  it("flags IPv6 loopback, unique-local, and link-local", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
  });

  it("does not flag a public IPv4 address", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  });
});

describe("assertSafeWebhookUrl", () => {
  it("rejects an invalid URL", async () => {
    await expect(assertSafeWebhookUrl("not a url")).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it("rejects http:// to a non-loopback host", async () => {
    // 10.x is a literal IP, so this never hits real DNS — resolves instantly and deterministically.
    await expect(assertSafeWebhookUrl("http://10.0.0.5/webhook")).rejects.toThrow(/HTTPS/i);
  });

  it("rejects a URL resolving to a private IP even over https", async () => {
    await expect(assertSafeWebhookUrl("https://10.0.0.5/webhook")).rejects.toThrow(/private or reserved/i);
    await expect(assertSafeWebhookUrl("https://192.168.1.1/webhook")).rejects.toThrow(/private or reserved/i);
  });

  it("allows a URL resolving to a public IP over https", async () => {
    await expect(assertSafeWebhookUrl("https://8.8.8.8/webhook")).resolves.toBeUndefined();
  });

  it("allows the explicit localhost carve-out outside production, over http", async () => {
    await expect(assertSafeWebhookUrl("http://localhost:3000/webhook")).resolves.toBeUndefined();
  });
});
