import { describe, expect, it } from "vitest";
import { findSecretShapedKeyPaths, redactSecrets } from "@/lib/security/redact";

describe("findSecretShapedKeyPaths", () => {
  it("returns an empty array when nothing looks secret-shaped", () => {
    expect(findSecretShapedKeyPaths({ amount: 1250, customer: "Acme Inc." })).toEqual([]);
  });

  it("finds a top-level secret-shaped key", () => {
    expect(findSecretShapedKeyPaths({ apiKey: "sk-abc123" })).toEqual(["apiKey"]);
  });

  it("finds a nested secret-shaped key by dotted path", () => {
    expect(findSecretShapedKeyPaths({ auth: { password: "hunter2" } })).toEqual(["auth"]);
  });

  it("never includes the actual secret value in its output", () => {
    const paths = findSecretShapedKeyPaths({ token: "super-secret-value-xyz" });
    expect(JSON.stringify(paths)).not.toContain("super-secret-value-xyz");
  });
});

describe("redactSecrets + findSecretShapedKeyPaths agree on what counts as secret-shaped", () => {
  it("every key findSecretShapedKeyPaths reports is actually masked by redactSecrets", () => {
    const value = { apiKey: "sk-abc", nested: { cookie: "session=1" }, safe: "fine" };
    const paths = findSecretShapedKeyPaths(value);
    const redacted = redactSecrets(value) as Record<string, unknown>;

    expect(paths).toEqual(["apiKey", "nested.cookie"]);
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).cookie).toBe("[REDACTED]");
    expect(redacted.safe).toBe("fine");
  });
});
