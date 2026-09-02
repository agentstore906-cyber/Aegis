"use server";

import { redirect } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageBilling } from "@/lib/billing/authorization";
import {
  createLemonSqueezyCheckout,
  getCustomerPortalUrl,
  isBillingConfigured,
} from "@/lib/billing/lemonsqueezy";
import { PLANS, type PlanId } from "@/lib/billing/plans";

export type BillingActionState = { error?: string };

/** This deployment's public origin — where Lemon Squeezy sends the customer after checkout. */
function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * Starts a Lemon Squeezy checkout for the given plan. The variant id to
 * charge is always resolved server-side from `PLANS` — the client only
 * ever sends a plan *id* ("growth"), never a variant or price, so a
 * tampered request can at most select a different *configured* plan, never
 * an arbitrary amount. The returned checkout grants nothing on its own:
 * only the signed webhook (app/api/webhooks/lemonsqueezy/route.ts) changes
 * the organization's plan.
 */
export async function createCheckoutSessionAction(planId: string): Promise<BillingActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: "Billing is not configured in this environment. See docs/deployment.md." };
  }

  const plan = PLANS[planId as PlanId];
  if (!plan || !plan.lemonSqueezyVariantId) {
    return { error: "This plan isn't available for self-serve checkout. Contact us instead." };
  }

  let checkoutUrl: string;
  try {
    checkoutUrl = await createLemonSqueezyCheckout({
      variantId: plan.lemonSqueezyVariantId,
      email: user.email,
      organizationId: organization.id,
      organizationName: organization.name,
      userId: user.id,
      redirectUrl: `${appBaseUrl()}/settings/billing?checkout=success`,
    });
  } catch (error) {
    console.error(JSON.stringify({ msg: "billing_checkout_action_failed", organizationId: organization.id, error: String(error) }));
    return { error: "Could not start checkout. Please try again in a moment." };
  }

  redirect(checkoutUrl);
}

/**
 * Opens the Lemon Squeezy customer portal so the org can update payment
 * methods, download invoices, or cancel — never handled directly by Aegis.
 * The portal URL is fetched fresh each time because Lemon Squeezy's are
 * short-lived.
 */
export async function createPortalSessionAction(): Promise<BillingActionState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: "Billing is not configured in this environment. See docs/deployment.md." };
  }

  if (!organization.lemonSqueezySubscriptionId) {
    return { error: "This organization doesn't have a subscription yet — subscribe to a plan first." };
  }

  const portalUrl = await getCustomerPortalUrl(organization.lemonSqueezySubscriptionId);
  if (!portalUrl) {
    return { error: "Could not open the billing portal right now. Please try again shortly." };
  }

  redirect(portalUrl);
}
