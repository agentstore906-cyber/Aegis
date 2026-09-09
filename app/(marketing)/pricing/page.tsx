import type { Metadata } from "next";

import { PricingPlans } from "@/components/pricing/pricing-plans";
import { buildPublicPlanCtas } from "@/lib/billing/upgrade-ctas";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, predictable pricing for teams running AI agents in production.",
};

/**
 * Public pricing. Renders the shared <PricingPlans> with public CTAs (every
 * plan routes into sign-up / sales). Once the visitor is signed in,
 * `/settings/billing` renders the exact same component and the exact same
 * `PRICING_PLANS` config with checkout-aware CTAs instead.
 */
export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">Pricing</h1>
        <p className="mt-4 text-muted-foreground">Start free. Add control as your AI workforce grows.</p>
      </div>

      <PricingPlans ctaByPlanId={buildPublicPlanCtas()} className="mt-14" />

      <p className="mt-12 text-center text-sm text-muted-foreground">
        Prices shown are current list prices and may change. Contact us for volume or annual pricing.
      </p>
    </div>
  );
}
