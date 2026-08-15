import { describe, expect, it, vi } from "vitest";

/**
 * `lib/env.ts` parses `process.env` once at import time, so different
 * allowlist scenarios need a fresh mock of `@/lib/env` per test rather
 * than mutating `process.env` after the fact.
 */
async function loadWithAllowlist(allowlist: string | undefined) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ env: { PLATFORM_ADMIN_EMAILS: allowlist } }));
  return import("@/lib/admin/authorization");
}

describe("isPlatformAdmin", () => {
  it("allows an email on the allowlist", async () => {
    const { isPlatformAdmin } = await loadWithAllowlist("owner@aegis.example,cofounder@aegis.example");
    expect(isPlatformAdmin("owner@aegis.example")).toBe(true);
  });

  it("is case-insensitive and trims whitespace in the allowlist", async () => {
    const { isPlatformAdmin } = await loadWithAllowlist(" Owner@Aegis.example , cofounder@aegis.example ");
    expect(isPlatformAdmin("owner@aegis.example")).toBe(true);
  });

  it("rejects an email not on the allowlist", async () => {
    const { isPlatformAdmin } = await loadWithAllowlist("owner@aegis.example");
    expect(isPlatformAdmin("random-user@example.com")).toBe(false);
  });

  it("rejects everyone when the allowlist is unset", async () => {
    const { isPlatformAdmin } = await loadWithAllowlist(undefined);
    expect(isPlatformAdmin("owner@aegis.example")).toBe(false);
  });

  it("rejects a null/undefined email", async () => {
    const { isPlatformAdmin } = await loadWithAllowlist("owner@aegis.example");
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});
