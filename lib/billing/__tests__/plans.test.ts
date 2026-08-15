import { describe, expect, it } from "vitest";
import { getPlan, PLANS, DEFAULT_PLAN_ID, type PlanId } from "@/lib/billing/plans";

describe("getPlan", () => {
  it("resolves a known plan id", () => {
    expect(getPlan("growth").id).toBe("growth");
  });

  it("falls back to the default plan for null/undefined/unrecognized input", () => {
    expect(getPlan(null).id).toBe(DEFAULT_PLAN_ID);
    expect(getPlan(undefined).id).toBe(DEFAULT_PLAN_ID);
    expect(getPlan("not-a-real-plan").id).toBe(DEFAULT_PLAN_ID);
  });
});

describe("PLANS", () => {
  const order = ["free", "startup", "growth", "business"] as const;

  it("has strictly increasing agent/member/API-key limits across the paid ladder", () => {
    for (let i = 1; i < order.length; i++) {
      const prev = PLANS[order[i - 1]];
      const curr = PLANS[order[i]];
      expect(curr.agentLimit!).toBeGreaterThan(prev.agentLimit!);
      expect(curr.memberLimit!).toBeGreaterThan(prev.memberLimit!);
      expect(curr.apiKeyLimit!).toBeGreaterThan(prev.apiKeyLimit!);
      expect(curr.priceCents!).toBeGreaterThan(prev.priceCents!);
    }
  });

  it("Enterprise has no numeric limits (unlimited) and custom pricing", () => {
    expect(PLANS.enterprise.agentLimit).toBeNull();
    expect(PLANS.enterprise.memberLimit).toBeNull();
    expect(PLANS.enterprise.apiKeyLimit).toBeNull();
    expect(PLANS.enterprise.priceCents).toBeNull();
  });

  it("Free has no Stripe price (never checked out) while paid plans read theirs from env", () => {
    expect(PLANS.free.stripePriceId).toBeNull();
  });
});

describe("PLANS as a checkout allowlist", () => {
  // createCheckoutSessionAction (lib/billing/actions.ts) resolves the Stripe
  // price to charge via `PLANS[planId as PlanId]` — a client-supplied planId
  // is a plain string, so this is the actual mechanism that prevents a
  // tampered request from ever resolving to an attacker-chosen price: an
  // unrecognized id must resolve to `undefined`, not fall back to any real
  // plan's price.
  it("does not resolve an unrecognized/tampered plan id to any configured plan", () => {
    expect(PLANS["not-a-real-plan" as PlanId]).toBeUndefined();
    expect(PLANS["../free" as PlanId]).toBeUndefined();
    expect(PLANS[Object.keys(PLANS)[0] + "\0" as PlanId]).toBeUndefined();
  });
});
