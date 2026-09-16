import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewBilling, canManageBilling } from "@/lib/billing/authorization";
import { getPlan } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/paddle";
import { buildAuthenticatedPlanCtas } from "@/lib/billing/upgrade-ctas";

import { PageHeader } from "@/components/dashboard/page-header";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { PaddleCheckoutProvider } from "@/components/settings/paddle-checkout-provider";

export const metadata: Metadata = { title: "Upgrade" };

/**
 * The "Upgrade" destination — pricing plans ONLY. Deliberately does not
 * render current plan / usage / any other billing status; that lives at
 * `/settings/billing`. Renders the exact same <PricingPlans> component and
 * `PRICING_PLANS` config as the public `/pricing` page (see
 * components/pricing/pricing-plans.tsx), with the same
 * buildAuthenticatedPlanCtas() wiring `/settings/billing` uses for its own
 * Plans section — so a Free org's CTA opens the real Paddle checkout, and a
 * paid org's CTA uses the real change-plan/portal flow. No second pricing
 * implementation, no fake checkout.
 */
export default async function UpgradePage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewBilling(role)) notFound();

  const plan = getPlan(organization.plan);
  const configured = isBillingConfigured();
  const canManage = canManageBilling(role);
  const hasSubscription = Boolean(organization.paddleSubscriptionId);

  const planCtas = buildAuthenticatedPlanCtas({ currentPlanId: plan.id, configured, canManage, hasSubscription });

  const plansSection = (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Plans" description="Start free. Add control as your AI workforce grows." />
      <PricingPlans ctaByPlanId={planCtas} currentPlanId={plan.id} />
    </div>
  );

  return canManage ? <PaddleCheckoutProvider>{plansSection}</PaddleCheckoutProvider> : plansSection;
}
