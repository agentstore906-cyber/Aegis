import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/billing/plans";
import { PRICING_PLANS } from "@/lib/pricing";
import { formatCurrency } from "@/lib/utils";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

/**
 * "One pricing source of truth" — proven structurally so a future edit that
 * reintroduces a second pricing definition fails CI.
 */
describe("PRICING_PLANS is the single pricing config", () => {
  it("defines each plan exactly once", () => {
    const ids = PRICING_PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives the Startup price from PLANS (lib/billing/plans.ts), not a hardcoded string", () => {
    const startup = PRICING_PLANS.find((p) => p.id === "startup")!;
    expect(startup.price).toBe(formatCurrency(PLANS.startup.priceCents!));
    expect(startup.price).toBe("$5");
    expect(startup.priceSuffix).toBe("/month");
  });

  it("keeps the Startup Paddle price id sourced from the real Paddle env config", () => {
    expect(PLANS.startup.paddlePriceId).toBe(process.env.PADDLE_STARTUP_PRICE_ID ?? null);
  });

  it("lib/pricing.ts imports its numbers from lib/billing/plans.ts (no parallel definition)", () => {
    const src = read("lib/pricing.ts");
    expect(src).toMatch(/from ["']@\/lib\/billing\/plans["']/);
    // The price string is computed, never typed as a literal.
    expect(src).not.toMatch(/price:\s*["']\$\d/);
  });
});

describe("both routes render the one shared component + one config", () => {
  const pricingPage = read("app/(marketing)/pricing/page.tsx");
  const billingPage = read("app/(dashboard)/settings/billing/page.tsx");
  const sharedComponent = read("components/pricing/pricing-plans.tsx");

  it("/pricing uses <PricingPlans> with the shared public CTA builder", () => {
    expect(pricingPage).toMatch(/from ["']@\/components\/pricing\/pricing-plans["']/);
    expect(pricingPage).toMatch(/buildPublicPlanCtas/);
    expect(pricingPage).toContain("<PricingPlans");
  });

  it("/settings/billing uses the SAME <PricingPlans> with the shared authenticated CTA builder", () => {
    expect(billingPage).toMatch(/from ["']@\/components\/pricing\/pricing-plans["']/);
    expect(billingPage).toMatch(/buildAuthenticatedPlanCtas/);
    expect(billingPage).toContain("<PricingPlans");
  });

  it("both CTA builders live in the same module", () => {
    const ctas = read("lib/billing/upgrade-ctas.ts");
    expect(ctas).toMatch(/export function buildPublicPlanCtas/);
    expect(ctas).toMatch(/export function buildAuthenticatedPlanCtas/);
    expect(pricingPage).toMatch(/from ["']@\/lib\/billing\/upgrade-ctas["']/);
    expect(billingPage).toMatch(/from ["']@\/lib\/billing\/upgrade-ctas["']/);
  });

  it("the billing page no longer defines its own plan cards / price formatting loop", () => {
    // The old bespoke "Subscribe" grid mapped over plan configs and formatted
    // prices itself. That duplication must stay gone.
    expect(billingPage).not.toMatch(/otherPlans/);
    expect(billingPage).not.toMatch(/candidate\.priceCents/);
  });

  it("the shared component reads card content only from PRICING_PLANS", () => {
    expect(sharedComponent).toMatch(/from ["']@\/lib\/pricing["']/);
    expect(sharedComponent).toContain("plan.price");
    expect(sharedComponent).toContain("plan.features");
  });

  it("there is no second/alternate pricing UI component", () => {
    // Guard against a future `UpgradePricing` / `PricingTable` / etc.
    const billingComponents = read("components/pricing/pricing-plans.tsx");
    expect(billingComponents).toContain("export function PricingPlans");
    expect(() => read("components/pricing/upgrade-pricing.tsx")).toThrow();
  });
});

describe("payment + subscription-state wiring is unchanged", () => {
  it("Free-user Upgrade goes through the existing Paddle checkout action", () => {
    const upgradeButton = read("components/settings/billing-upgrade-button.tsx");
    expect(upgradeButton).toMatch(/usePaddleCheckout/);
    expect(upgradeButton).toMatch(/openCheckoutForPlan/);

    const provider = read("components/settings/paddle-checkout-provider.tsx");
    expect(provider).toMatch(/createCheckoutSessionAction/);
    expect(provider).toMatch(/window\.Paddle!?\.Checkout\.open/);
  });

  it("paid-user CTA uses the existing customer-portal action", () => {
    const portalButton = read("components/settings/billing-portal-button.tsx");
    expect(portalButton).toMatch(/createPortalSessionAction/);
  });

  it("subscription state is still only written by the signed Paddle webhook", () => {
    const webhook = read("app/api/webhooks/paddle/route.ts");
    expect(webhook).toMatch(/verifyAndUnmarshalWebhook/);
    expect(webhook).toMatch(/syncSubscriptionState|recordTransactionOutcome/);

    // The new shared modules must not touch the DB or mutate the org plan.
    const ctas = read("lib/billing/upgrade-ctas.ts");
    const sharedComponent = read("components/pricing/pricing-plans.tsx");
    for (const src of [ctas, sharedComponent]) {
      expect(src).not.toMatch(/prisma/);
      expect(src).not.toMatch(/organization\.update/);
    }
  });

  it("cancellation flow is untouched", () => {
    const cancelButton = read("components/settings/billing-cancel-button.tsx");
    expect(cancelButton).toMatch(/cancelSubscriptionAction/);
    const billingPage = read("app/(dashboard)/settings/billing/page.tsx");
    expect(billingPage).toContain("<BillingCancelButton />");
  });

  it("no mock / fake payment or subscription helpers were introduced", () => {
    for (const rel of [
      "lib/billing/upgrade-ctas.ts",
      "components/pricing/pricing-plans.tsx",
      "app/(dashboard)/settings/billing/page.tsx",
      "app/(marketing)/pricing/page.tsx",
    ]) {
      const src = read(rel).toLowerCase();
      expect(src).not.toMatch(/mock|fake|stub|dummy subscription|simulate.*payment/);
    }
  });
});
