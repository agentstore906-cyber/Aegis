import type { Metadata } from "next";
import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRICING_PLANS } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, predictable pricing for teams running AI agents in production.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">Pricing</h1>
        <p className="mt-4 text-muted-foreground">
          Start free. Add control as your AI workforce grows.
        </p>
      </div>

      <div className="mt-14 grid gap-4 lg:grid-cols-5">
        {PRICING_PLANS.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "flex flex-col rounded-xl border p-6",
              plan.featured
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-surface"
            )}
          >
            <p
              className={cn(
                "text-sm font-medium",
                plan.featured ? "text-background/70" : "text-muted-foreground"
              )}
            >
              {plan.name}
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
              {plan.priceSuffix && (
                <span
                  className={cn(
                    "text-sm",
                    plan.featured ? "text-background/70" : "text-muted-foreground"
                  )}
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

            <ButtonLink
              href={plan.id === "enterprise" ? "/sign-up" : "/sign-up"}
              variant={plan.featured ? "secondary" : "primary"}
              className={cn(
                "mt-6 w-full",
                plan.featured && "bg-background text-foreground hover:bg-background/90"
              )}
            >
              {plan.cta}
            </ButtonLink>

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
                  <span className={plan.featured ? "text-background/90" : "text-foreground"}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-12 text-center text-sm text-muted-foreground">
        Prices shown are current list prices and may change. Contact us for volume or
        annual pricing.
      </p>
    </div>
  );
}
