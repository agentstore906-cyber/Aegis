import { describe, expect, it } from "vitest";

import {
  buildAuthenticatedPlanCtas,
  buildPublicPlanCtas,
  type AuthenticatedPlanCtaInput,
} from "@/lib/billing/upgrade-ctas";
import { PLANS } from "@/lib/billing/plans";
import { PRICING_PLANS } from "@/lib/pricing";

const AUTH_BASE: AuthenticatedPlanCtaInput = {
  currentPlanId: "free",
  configured: true,
  canManage: true,
  hasSubscription: false,
};

/**
 * Both `/pricing` and `/settings/billing` build their card CTAs here, then
 * hand the result to the SAME <PricingPlans> component. These tests pin the
 * two things that matter for "the pricing experience is the same":
 *
 *   1. both builders iterate the same `PRICING_PLANS` config, so the set and
 *      order of cards can never diverge, and
 *   2. only the CTA changes with auth / subscription state — never a price,
 *      name, feature, or Paddle id (those aren't even in scope here).
 */
describe("pricing CTA builders share one config", () => {
  it("public and authenticated builders emit a CTA for exactly the PRICING_PLANS ids, in order", () => {
    const configIds = PRICING_PLANS.map((p) => p.id);

    expect(Object.keys(buildPublicPlanCtas())).toEqual(configIds);

    for (const override of [
      AUTH_BASE,
      { ...AUTH_BASE, currentPlanId: "startup", hasSubscription: true },
      { ...AUTH_BASE, configured: false },
      { ...AUTH_BASE, canManage: false },
    ] satisfies AuthenticatedPlanCtaInput[]) {
      expect(Object.keys(buildAuthenticatedPlanCtas(override))).toEqual(configIds);
    }
  });
});

describe("buildPublicPlanCtas (unauthenticated /pricing)", () => {
  const ctas = buildPublicPlanCtas();

  it("routes the Startup card into the existing public sign-up flow", () => {
    expect(ctas.startup).toEqual({ kind: "link", label: PRICING_PLANS.find((p) => p.id === "startup")!.cta, href: "/sign-up" });
  });

  it("routes Enterprise to sales", () => {
    expect(ctas.enterprise).toMatchObject({ kind: "link", href: "/contact?source=enterprise" });
  });

  it("never emits a checkout / portal / change CTA (no authenticated actions on the public page)", () => {
    for (const cta of Object.values(ctas)) {
      expect(["checkout", "portal", "change"]).not.toContain(cta.kind);
    }
  });
});

describe("buildAuthenticatedPlanCtas — Free org", () => {
  const ctas = buildAuthenticatedPlanCtas({ ...AUTH_BASE, currentPlanId: "free" });

  it("gives the Startup card an Upgrade CTA that opens real Paddle checkout for the startup plan", () => {
    expect(ctas.startup).toEqual({ kind: "checkout", label: "Upgrade", planId: "startup" });
  });

  it("marks the Free card as the current plan", () => {
    expect(ctas.free).toEqual({ kind: "current", label: "Current plan" });
  });

  it("still sends Enterprise to sales, exactly like the public page", () => {
    expect(ctas.enterprise).toEqual(buildPublicPlanCtas().enterprise);
  });
});

describe("buildAuthenticatedPlanCtas — active Startup subscriber", () => {
  const ctas = buildAuthenticatedPlanCtas({
    currentPlanId: "startup",
    configured: true,
    canManage: true,
    hasSubscription: true,
  });

  it("gives the Startup (current) card the existing Manage-subscription / portal flow", () => {
    expect(ctas.startup).toEqual({ kind: "portal", label: "Manage subscription" });
  });

  it("offers other paid plans as a subscription change, not a fresh checkout", () => {
    expect(ctas.growth).toEqual({ kind: "change", label: "Switch to Growth", planId: "growth" });
    expect(ctas.business).toEqual({ kind: "change", label: "Switch to Business", planId: "business" });
  });
});

describe("buildAuthenticatedPlanCtas — guard rails", () => {
  it("shows a passive note (no checkout) when Paddle is not configured", () => {
    const ctas = buildAuthenticatedPlanCtas({ ...AUTH_BASE, configured: false });
    expect(ctas.startup).toEqual({ kind: "note", label: "Contact us to upgrade" });
  });

  it("shows a passive note (no checkout) for members who cannot manage billing", () => {
    const ctas = buildAuthenticatedPlanCtas({ ...AUTH_BASE, canManage: false });
    expect(ctas.startup).toEqual({ kind: "note", label: "Ask an owner or admin to upgrade" });
  });

  it("falls back to a note when a paid plan has no Paddle price id configured", () => {
    // Drive the real branch: temporarily blank the env-sourced price id.
    const original = PLANS.startup.paddlePriceId;
    try {
      (PLANS.startup as { paddlePriceId: string | null }).paddlePriceId = null;
      const ctas = buildAuthenticatedPlanCtas({ ...AUTH_BASE });
      expect(ctas.startup).toEqual({ kind: "note", label: "Contact us to upgrade" });
    } finally {
      (PLANS.startup as { paddlePriceId: string | null }).paddlePriceId = original;
    }
  });
});
