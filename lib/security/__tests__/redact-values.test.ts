/** P1 §8 — value-based redaction of unambiguous credential formats (defense in depth). */
import { describe, expect, it } from "vitest";

import { redactSecretValues } from "@/lib/security/redact";

const SAMPLES: Record<string, string> = {
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  openai_or_anthropic_key: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
  stripe_key: "sk_live_abcdefghijklmnop1234",
  github_token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
  slack_token: "xoxb-1234567890-abcdefghij",
  aegis_api_key: "aegis_live_abcdefghijklmnopqrstuvwxyz",
  google_api_key: "AIzaSyA-abcdefghijklmnopqrstuvwxyz01234",
};

describe("redactSecretValues", () => {
  for (const [kind, secret] of Object.entries(SAMPLES)) {
    it(`redacts a ${kind} embedded in text and reports only its kind`, () => {
      const result = redactSecretValues(`used ${secret} to call the API`);
      expect(result.value).toBe("used [REDACTED] to call the API");
      expect(result.redactedCount).toBe(1);
      expect(result.kinds).toEqual([kind]);
      expect(JSON.stringify(result)).not.toContain(secret);
    });
  }

  it("redacts bearer tokens, PEM private keys, and credentials embedded in URLs (keeping the host)", () => {
    expect(redactSecretValues("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456").value).toBe("Authorization: [REDACTED]");
    expect(
      redactSecretValues("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----").value
    ).toBe("[REDACTED]");
    expect(redactSecretValues("postgres://admin:hunter2@db.internal:5432/app").value).toBe("postgres://[REDACTED]@db.internal:5432/app");
  });

  it("walks nested objects and arrays, leaving keys and non-strings intact", () => {
    const result = redactSecretValues({ notes: [`token ${SAMPLES.github_token}`], count: 3, ok: true, nested: { n: null } });
    expect(result.value).toEqual({ notes: ["token [REDACTED]"], count: 3, ok: true, nested: { n: null } });
    expect(result.redactedCount).toBe(1);
  });

  it("leaves ordinary text alone (no false positives on everyday strings)", () => {
    const text = "Refunded order 12345 for jane@example.com via sk-api docs; see https://example.com/path?q=1";
    expect(redactSecretValues(text)).toEqual({ value: text, redactedCount: 0, kinds: [] });
    expect(redactSecretValues(undefined)).toEqual({ value: undefined, redactedCount: 0, kinds: [] });
  });
});
