/**
 * Integration test against the real dev database, modeled on
 * lib/policies/__tests__/repository.integration.test.ts. Authentication
 * correctness (valid/invalid/revoked/expired, and that a key never
 * resolves to the wrong organization) is fundamentally a query-layer
 * guarantee, so it's tested here against real Postgres rather than mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createApiKey, revokeApiKey } from "@/lib/api-keys/repository";
import { authenticateApiKey } from "@/lib/api-keys/service";
import { ExpiredApiKeyError, InvalidApiKeyError, RevokedApiKeyError } from "@/lib/api-keys/types";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "API Keys Org A", slug: `${RUN_ID}-keys-a` } });
  orgB = await prisma.organization.create({ data: { name: "API Keys Org B", slug: `${RUN_ID}-keys-b` } });
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("authenticateApiKey", () => {
  it("authenticates a valid key and returns its owning organization", async () => {
    const { raw } = await createApiKey(orgA.id, null, { name: "Valid key", environment: "LIVE" });

    const { organization, apiKey } = await authenticateApiKey(`Bearer ${raw}`);

    expect(organization.id).toBe(orgA.id);
    expect(apiKey.organizationId).toBe(orgA.id);
  });

  it("never resolves a key created for org A to org B, or vice versa", async () => {
    const { raw } = await createApiKey(orgA.id, null, { name: "Org isolation key", environment: "LIVE" });

    const { organization } = await authenticateApiKey(`Bearer ${raw}`);
    expect(organization.id).not.toBe(orgB.id);
    expect(organization.id).toBe(orgA.id);
  });

  it("rejects a key that doesn't exist", async () => {
    await expect(authenticateApiKey("Bearer aegis_live_" + "a".repeat(32))).rejects.toThrow(InvalidApiKeyError);
  });

  it("rejects malformed authorization headers", async () => {
    await expect(authenticateApiKey(null)).rejects.toThrow();
    await expect(authenticateApiKey("not-a-bearer-token")).rejects.toThrow();
    await expect(authenticateApiKey("Basic abc123")).rejects.toThrow();
  });

  it("rejects a revoked key", async () => {
    const { raw, apiKey } = await createApiKey(orgA.id, null, { name: "Revoked key", environment: "LIVE" });
    await revokeApiKey(orgA.id, apiKey.id);

    await expect(authenticateApiKey(`Bearer ${raw}`)).rejects.toThrow(RevokedApiKeyError);
  });

  it("rejects an expired key", async () => {
    const { raw } = await createApiKey(orgA.id, null, {
      name: "Expired key",
      environment: "LIVE",
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(authenticateApiKey(`Bearer ${raw}`)).rejects.toThrow(ExpiredApiKeyError);
  });

  it("does not reject a key with a future expiration", async () => {
    const { raw } = await createApiKey(orgA.id, null, {
      name: "Future expiry key",
      environment: "LIVE",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(authenticateApiKey(`Bearer ${raw}`)).resolves.toBeDefined();
  });
});

describe("revokeApiKey", () => {
  it("is scoped to the organization — cannot revoke another org's key", async () => {
    const { apiKey } = await createApiKey(orgA.id, null, { name: "Cross-org revoke attempt", environment: "LIVE" });

    const revoked = await revokeApiKey(orgB.id, apiKey.id);
    expect(revoked).toBe(false);

    const stillActive = await prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(stillActive.revokedAt).toBeNull();
  });
});
