import { describe, expect, it } from "vitest";

import {
  AdvancedPolicyNotAllowedError,
  advancedPolicyDenial,
  assertAdvancedPolicyAllowed,
  policyConditionsLock,
  policyUsesAdvancedFeatures,
} from "@/lib/policies/entitlement";
import type { PrismaOrTx } from "@/lib/db";

const clientFor = (plan: string) =>
  ({ organization: { findUniqueOrThrow: async () => ({ plan }) } }) as unknown as PrismaOrTx;

describe("what counts as an advanced policy", () => {
  it("a policy with conditions is advanced; scope fields alone are not", () => {
    expect(policyUsesAdvancedFeatures({ conditions: [] })).toBe(false);
    expect(policyUsesAdvancedFeatures({ conditions: [{ field: "context.amount", operator: "GREATER_THAN", value: 5 }] })).toBe(true);
  });
});

describe("advancedPolicyDenial", () => {
  it("denies Free with the reason and a concrete upgrade target", () => {
    const message = advancedPolicyDenial("free");
    expect(message).toContain("Free plan");
    expect(message).toContain("Upgrade to the Startup plan");
  });

  it.each(["startup", "growth", "business", "enterprise"])("allows %s", (plan) => {
    expect(advancedPolicyDenial(plan)).toBeNull();
  });

  it("treats an unknown / legacy / null plan as Free (never as a paid plan)", () => {
    expect(advancedPolicyDenial("legacy-plan")).not.toBeNull();
    expect(advancedPolicyDenial(null)).not.toBeNull();
    expect(advancedPolicyDenial(undefined)).not.toBeNull();
  });
});

describe("assertAdvancedPolicyAllowed", () => {
  it("never touches the database for a basic policy", async () => {
    const exploding = { organization: { findUniqueOrThrow: () => { throw new Error("must not query"); } } } as unknown as PrismaOrTx;
    await expect(assertAdvancedPolicyAllowed(exploding, "org", false)).resolves.toBeUndefined();
  });

  it("throws AdvancedPolicyNotAllowedError with the upgrade message on Free", async () => {
    const error = await assertAdvancedPolicyAllowed(clientFor("free"), "org", true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdvancedPolicyNotAllowedError);
    expect((error as Error).message).toMatch(/Free plan.*Upgrade to the Startup plan/);
  });

  it("passes on a plan that includes advanced policies", async () => {
    await expect(assertAdvancedPolicyAllowed(clientFor("startup"), "org", true)).resolves.toBeUndefined();
  });
});

describe("policyConditionsLock (what the form mirrors)", () => {
  it("is absent on plans that include conditions", () => {
    expect(policyConditionsLock("growth", true)).toBeUndefined();
  });

  it("is present on Free, and records whether the viewer may open /upgrade", () => {
    expect(policyConditionsLock("free", true)).toMatchObject({ canUpgrade: true });
    expect(policyConditionsLock("free", false)).toMatchObject({ canUpgrade: false });
    expect(policyConditionsLock("free", false)!.message).toContain("Free plan");
  });
});
