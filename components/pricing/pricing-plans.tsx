import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { BillingUpgradeButton } from "@/components/settings/billing-upgrade-button";
import { BillingChangePlanButton } from "@/components/settings/billing-change-plan-button";
import { BillingPortalButton } from "@/components/settings/billing-portal-button";
import { PRICING_PLANS, type PricingPlan } from "@/lib/pricing";
import type { PlanCta } from "@/lib/billing/upgrade-ctas";
import { cn } from "@/lib/utils";

export type { PlanCta };

/**
 * The single pricing UI, shared verbatim between the public `/pricing` page
 * and the authenticated `/settings/billing` view. The plan cards — name,
 * price, billing interval, description, feature list, layout, and styling —
 * are identical in both places and come entirely from `lib/pricing.ts`
 * (which itself derives its numbers from `lib/billing/plans.ts`). The only
 * thing a caller controls is the per-plan call-to-action (`PlanCta`, defined
 * in `lib/billing/upgrade-ctas.ts`), because that is the one thing that
 * legitimately differs by context (an anonymous visitor gets "Get started",
 * a signed-in Free org gets a real Paddle "Upgrade", the org's current plan
 * gets "Manage subscription", etc.).
 */

function PlanCtaSlot({ cta, featured }: { cta: PlanCta; featured: boolean }) {
  const variant: "primary" | "secondary" = featured ? "secondary" : "primary";
  const buttonClassName = cn(featured && "bg-background text-foreground hover:bg-background/90");

  switch (cta.kind) {
    case "link":
      return (
        <ButtonLink href={cta.href} variant={variant} className={cn("mt-6 w-full", buttonClassName)}>
          {cta.label}
        </ButtonLink>
      );
    case "checkout":
      return (
        <div className="mt-6">
          <BillingUpgradeButton planId={cta.planId} label={cta.label} variant={variant} className={buttonClassName} />
        </div>
      );
    case "change":
      return (
        <div className="mt-6">
          <BillingChangePlanButton planId={cta.planId} label={cta.label} variant={variant} className={buttonClassName} />
        </div>
      );
    case "portal":
      return (
        <div className="mt-6">
          <BillingPortalButton label={cta.label} variant={variant} className={cn("w-full", buttonClassName)} />
        </div>
      );
    case "current":
      return (
        <Button type="button" variant="secondary" className="mt-6 w-full" disabled>
          {cta.label}
        </Button>
      );
    case "note":
      return (
        <p
          className={cn(
            "mt-6 text-center text-xs",
            featured ? "text-background/70" : "text-muted-foreground"
          )}
        >
          {cta.label}
        </p>
      );
  }
}

export function PricingPlans({
  ctaByPlanId,
  currentPlanId,
  plans = PRICING_PLANS,
  className,
}: {
  /** One CTA per plan id. A plan with no entry renders no CTA. */
  ctaByPlanId: Record<string, PlanCta>;
  /** When set, that plan's card gets a "Current plan" badge. */
  currentPlanId?: string;
  plans?: PricingPlan[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-5", className)}>
      {plans.map((plan) => {
        const cta = ctaByPlanId[plan.id];
        const isCurrent = plan.id === currentPlanId;
        return (
          <div
            key={plan.id}
            className={cn(
              "flex flex-col rounded-xl border p-6",
              plan.featured ? "border-foreground bg-foreground text-background" : "border-border bg-surface"
            )}
          >
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  "text-sm font-medium",
                  plan.featured ? "text-background/70" : "text-muted-foreground"
                )}
              >
                {plan.name}
              </p>
              {isCurrent && (
                <Badge tone="success" className={cn(plan.featured && "border-transparent")}>
                  Current plan
                </Badge>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
              {plan.priceSuffix && (
                <span
                  className={cn("text-sm", plan.featured ? "text-background/70" : "text-muted-foreground")}
                >
                  {plan.priceSuffix}
                </span>
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-sm",
                plan.featured ? "text-background/80" : "text-muted-foreground"
              )}
            >
              {plan.description}
            </p>

            {cta && <PlanCtaSlot cta={cta} featured={Boolean(plan.featured)} />}

            <ul className="mt-6 space-y-2.5 text-sm">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      plan.featured ? "text-background/70" : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                  <span className={plan.featured ? "text-background/90" : "text-foreground"}>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
