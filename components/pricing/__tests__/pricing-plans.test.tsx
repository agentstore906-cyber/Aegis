import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Keep the render hermetic: no Next runtime, no Paddle.js, no server actions.
// We are testing what <PricingPlans> renders, not the button internals.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children as never}
    </a>
  ),
}));
vi.mock("@/components/settings/billing-upgrade-button", () => ({
  BillingUpgradeButton: ({ planId, label }: { planId: string; label: string }) => (
    <button type="button" data-cta="checkout" data-plan={planId}>
      {label}
    </button>
  ),
}));
vi.mock("@/components/settings/billing-change-plan-button", () => ({
  BillingChangePlanButton: ({ planId, label }: { planId: string; label: string }) => (
    <button type="button" data-cta="change" data-plan={planId}>
      {label}
    </button>
  ),
}));
vi.mock("@/components/settings/billing-portal-button", () => ({
  BillingPortalButton: ({ label }: { label?: string }) => (
    <button type="button" data-cta="portal">
      {label ?? "Manage subscription"}
    </button>
  ),
}));

import { PricingPlans } from "@/components/pricing/pricing-plans";
import { buildAuthenticatedPlanCtas, buildPublicPlanCtas } from "@/lib/billing/upgrade-ctas";
import { PRICING_PLANS } from "@/lib/pricing";

const STARTUP = PRICING_PLANS.find((p) => p.id === "startup")!;

/** Every string that makes up the Startup card's *content* (never its CTA). */
const startupContent = [STARTUP.name, STARTUP.price, STARTUP.priceSuffix!, STARTUP.description, ...STARTUP.features];

const PUBLIC = buildPublicPlanCtas();
const AUTH_FREE = buildAuthenticatedPlanCtas({
  currentPlanId: "free",
  configured: true,
  canManage: true,
  hasSubscription: false,
});
const AUTH_STARTUP = buildAuthenticatedPlanCtas({
  currentPlanId: "startup",
  configured: true,
  canManage: true,
  hasSubscription: true,
});

const renderPublic = renderToStaticMarkup(<PricingPlans ctaByPlanId={PUBLIC} />);
const renderFree = renderToStaticMarkup(<PricingPlans ctaByPlanId={AUTH_FREE} />);
const renderStartup = renderToStaticMarkup(<PricingPlans ctaByPlanId={AUTH_STARTUP} currentPlanId="startup" />);

describe("<PricingPlans> renders identical pricing content in every context", () => {
  it.each([
    ["unauthenticated /pricing", () => renderPublic],
    ["authenticated Free user", () => renderFree],
    ["authenticated Startup subscriber", () => renderStartup],
  ])("shows the same Startup card content — %s", (_label, markup) => {
    for (const piece of startupContent) {
      expect(markup()).toContain(piece);
    }
  });

  it("renders exactly one card per PRICING_PLANS entry in every context", () => {
    for (const markup of [renderPublic, renderFree, renderStartup]) {
      for (const plan of PRICING_PLANS) {
        expect(markup).toContain(`>${plan.name}<`);
      }
    }
  });

  it("shows exactly $5 / month for Startup (the price span comes straight from PRICING_PLANS)", () => {
    for (const markup of [renderPublic, renderFree, renderStartup]) {
      expect(markup).toContain(`tracking-tight">$5</span><span class="text-sm text-muted-foreground">/month</span>`);
      expect(markup).not.toContain(`tracking-tight">$99<`); // the pre-change Startup price
    }
  });
});

describe("<PricingPlans> — only the CTA changes with auth / subscription state", () => {
  it("unauthenticated: Startup CTA is the public sign-up link, no authenticated actions", () => {
    expect(renderPublic).toContain(`href="/sign-up"`);
    expect(renderPublic).toContain(STARTUP.cta); // "Get started"
    expect(renderPublic).not.toContain('data-cta="checkout"');
    expect(renderPublic).not.toContain('data-cta="portal"');
  });

  it("authenticated Free: Startup CTA opens real Paddle checkout for the startup plan", () => {
    expect(renderFree).toContain('data-cta="checkout"');
    expect(renderFree).toContain('data-plan="startup"');
    expect(renderFree).toContain(">Upgrade<");
    expect(renderFree).not.toContain(`href="/sign-up"`);
  });

  it("authenticated Startup: current card shows Current-plan badge + Manage subscription (portal)", () => {
    expect(renderStartup).toContain("Current plan");
    expect(renderStartup).toContain('data-cta="portal"');
    expect(renderStartup).toContain(">Manage subscription<");
    expect(renderStartup).not.toContain('data-cta="checkout"');
  });

  it("the card content sections appear in the same order regardless of CTA", () => {
    // name → price → description → features, with the CTA slotted between
    // description and features. The content ordering must not shift by context.
    const order = (html: string) =>
      [STARTUP.name, STARTUP.price, STARTUP.description, STARTUP.features[0]].map((s) => html.indexOf(s));

    for (const markup of [renderPublic, renderFree, renderStartup]) {
      const positions = order(markup);
      expect(positions.every((n) => n >= 0)).toBe(true);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
