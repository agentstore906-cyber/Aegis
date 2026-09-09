import "server-only";

import { PLANS, type PlanId } from "@/lib/billing/plans";
import { PRICING_PLANS } from "@/lib/pricing";

/**
 * The per-plan call-to-action for a <PricingPlans> card. The pricing *content*
 * (plan name, price, billing interval, description, feature list, layout,
 * styling) is identical everywhere and comes entirely from `lib/pricing.ts`.
 * The CTA is the one thing that legitimately differs by context:
 *
 *   - public `/pricing`            → every card is a `link` into sign-up / sales
 *   - authenticated `/settings/billing`:
 *       Free org, paid card        → `checkout` (real Paddle overlay)
 *       paid org, another paid card → `change`  (real Paddle plan change)
 *       the org's current plan     → `portal`   (real Paddle customer portal)
 *       otherwise                  → `current` / `note`
 *
 * Both builders below iterate `PRICING_PLANS`, so the set of cards and their
 * order can never diverge between the two pages.
 */
export type PlanCta =
  | { kind: "link"; label: string; href: string }
  /** Opens the real Paddle checkout overlay for `planId` (BillingUpgradeButton). */
  | { kind: "checkout"; label: string; planId: string }
  /** Switches an existing subscription to `planId` (BillingChangePlanButton). */
  | { kind: "change"; label: string; planId: string }
  /** Opens the Paddle customer portal (BillingPortalButton). */
  | { kind: "portal"; label: string }
  /** Non-interactive "this is your plan" marker. */
  | { kind: "current"; label: string }
  /** Non-interactive helper text (e.g. "Contact us to upgrade"). */
  | { kind: "note"; label: string };

const ENTERPRISE_HREF = "/contact?source=enterprise";

/**
 * Public `/pricing`: every plan's CTA sends the visitor into sign-up (or to
 * sales for Enterprise). This is the pre-existing public pricing flow.
 */
export function buildPublicPlanCtas(): Record<string, PlanCta> {
  return Object.fromEntries(
    PRICING_PLANS.map((plan): [string, PlanCta] => [
      plan.id,
      {
        kind: "link",
        label: plan.cta,
        href: plan.id === "enterprise" ? ENTERPRISE_HREF : "/sign-up",
      },
    ])
  );
}

export type AuthenticatedPlanCtaInput = {
  /** The org's currently-enforced plan id (`Organization.plan`). */
  currentPlanId: string;
  /** `isBillingConfigured()` — are Paddle credentials present in this env. */
  configured: boolean;
  /** `canManageBilling(role)` — may this member check out / change / open the portal. */
  canManage: boolean;
  /** `Boolean(Organization.paddleSubscriptionId)` — is there a live Paddle subscription. */
  hasSubscription: boolean;
};

/**
 * Authenticated `/settings/billing`: same cards as `/pricing`, but the CTA is
 * wired to the org's real subscription state and the existing Paddle actions
 * (`lib/billing/actions.ts`). Nothing here mutates subscription state — that
 * still happens only via the signed Paddle webhook.
 */
export function buildAuthenticatedPlanCtas(input: AuthenticatedPlanCtaInput): Record<string, PlanCta> {
  const { currentPlanId, configured, canManage, hasSubscription } = input;

  return Object.fromEntries(
    PRICING_PLANS.map((plan): [string, PlanCta] => {
      const config = PLANS[plan.id as PlanId];
      const isCurrent = plan.id === currentPlanId;

      if (plan.id === "enterprise") {
        return [plan.id, { kind: "link", label: plan.cta, href: ENTERPRISE_HREF }];
      }

      if (isCurrent) {
        if (canManage && hasSubscription && configured) {
          return [plan.id, { kind: "portal", label: "Manage subscription" }];
        }
        return [plan.id, { kind: "current", label: "Current plan" }];
      }

      if (plan.id === "free") {
        return [plan.id, { kind: "note", label: "Included with every plan" }];
      }

      // A paid, self-serve plan that isn't the current one.
      if (!configured || !config?.paddlePriceId) {
        return [plan.id, { kind: "note", label: "Contact us to upgrade" }];
      }
      if (!canManage) {
        return [plan.id, { kind: "note", label: "Ask an owner or admin to upgrade" }];
      }
      if (hasSubscription) {
        return [plan.id, { kind: "change", label: `Switch to ${plan.name}`, planId: plan.id }];
      }
      return [plan.id, { kind: "checkout", label: "Upgrade", planId: plan.id }];
    })
  );
}
