/** P1 §8 — end users are stored only as keyed, organization-scoped pseudonyms. */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pseudonymizeEndUser } from "@/lib/telemetry/pseudonymize";

let saved: { auth?: string; key?: string };
beforeEach(() => {
  saved = { auth: process.env.AUTH_SECRET, key: process.env.TELEMETRY_HASH_KEY };
  process.env.AUTH_SECRET = "pseudonym-test-auth-secret-0123456789abcdef";
  delete process.env.TELEMETRY_HASH_KEY;
});
afterEach(() => {
  if (saved.auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved.auth;
  if (saved.key === undefined) delete process.env.TELEMETRY_HASH_KEY;
  else process.env.TELEMETRY_HASH_KEY = saved.key;
});

describe("pseudonymizeEndUser", () => {
  it("is stable for the same user in the same org, and never contains the raw id", () => {
    const a = pseudonymizeEndUser("org_1", "jane@example.com");
    expect(pseudonymizeEndUser("org_1", "jane@example.com")).toBe(a);
    expect(pseudonymizeEndUser("org_1", "  jane@example.com ")).toBe(a);
    expect(a).toMatch(/^as[0-9a-f]{6}:[0-9a-f]{32}$/);
    expect(a).not.toContain("jane");
  });

  it("is organization-scoped and user-specific", () => {
    expect(pseudonymizeEndUser("org_2", "jane@example.com")).not.toBe(pseudonymizeEndUser("org_1", "jane@example.com"));
    expect(pseudonymizeEndUser("org_1", "john@example.com")).not.toBe(pseudonymizeEndUser("org_1", "jane@example.com"));
  });

  it("is keyed: a different key gives unrelated values, and the key id shows which key was used", () => {
    const derived = pseudonymizeEndUser("org_1", "jane@example.com");
    process.env.TELEMETRY_HASH_KEY = randomBytes(32).toString("base64");
    const dedicated = pseudonymizeEndUser("org_1", "jane@example.com");
    expect(dedicated).toMatch(/^tk[0-9a-f]{6}:/);
    expect(dedicated.split(":")[1]).not.toBe(derived.split(":")[1]);
  });

  it("rejects a too-short dedicated key", () => {
    process.env.TELEMETRY_HASH_KEY = Buffer.from("short").toString("base64");
    expect(() => pseudonymizeEndUser("org_1", "x")).toThrow(/at least 32 bytes/);
  });
});
