"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { prisma } from "@/lib/db";
import { canManageBilling } from "@/lib/billing/authorization";
import {
  ensurePaddleCustomer,
  getCustomerPortalUrl,
  cancelPaddleSubscription,
  changePaddleSubscriptionPlan,
  isBillingConfigured,
  describePaddleError,
} from "@/lib/billing/paddle";
import { PLANS, type PlanId } from "@/lib/billing/plans";

export type BillingActionState = { error?: string };

const NOT_CONFIGURED_ERROR = "Billing is not configured in this environment. See docs/deployment.md.";

/** Non-secret parameters the client feeds directly into `Paddle.Checkout.open()` — see components/settings/paddle-checkout-provider.tsx. */
export type CheckoutSessionParams = {
  priceId: string;
  customerId: string;
  customData: { organizationId: string; userId: string };
};

export type CheckoutSessionState = { error?: string; checkout?: CheckoutSessionParams };

/**
 * Resolves the Paddle price + customer to open a checkout overlay for.
 * The price id is always resolved server-side from `PLANS` — the client
 * only ever sends a plan *id* ("growth"), never a price, so a tampered
 * request can at most select a different *configured* plan, never an
 * arbitrary amount. Nothing is charged by this action itself: it hands the
 * browser a real price id (and the org's existing Paddle customer id, if
 * any) to open Paddle's own hosted checkout overlay with; only the signed
 * webhook (app/api/webhooks/paddle/route.ts), reading the price Paddle
 * itself confirms was paid, ever changes the organization's plan.
 */
export async function createCheckoutSessionAction(planId: string): Promise<CheckoutSessionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: NOT_CONFIGURED_ERROR };
  }

  const plan = PLANS[planId as PlanId];
  if (!plan || planId === "free" || planId === "enterprise" || !plan.paddlePriceId) {
    return { error: "This plan isn't available for self-serve checkout. Contact us instead." };
  }

  let customerId: string;
  try {
    customerId = await ensurePaddleCustomer({
      existingCustomerId: organization.paddleCustomerId,
      email: user.email,
      name: organization.name,
      organizationId: organization.id,
    });

    // Cache the customer id immediately so a second checkout attempt (or the
    // portal button) reuses it rather than minting a new Paddle customer —
    // the webhook will also set this, but doesn't fire until payment.
    if (customerId !== organization.paddleCustomerId) {
      await prisma.organization.update({
        where: { id: organization.id },
        data: { paddleCustomerId: customerId },
      });
    }
  } catch (error) {
    // Log Paddle's own safe error vocabulary (type/code/detail — never a
    // key, token or card value) so an operator can tell a misconfiguration
    // (`authentication_failed` → wrong PADDLE_ENVIRONMENT / key) from a
    // transient Paddle outage. The user still sees only the clean message.
    console.error(
      JSON.stringify({
        msg: "billing_checkout_action_failed",
        organizationId: organization.id,
        paddleEnvironment: process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase() ?? null,
        error: describePaddleError(error),
      })
    );
    return { error: "Could not start checkout. Please try again in a moment." };
  }

  return {
    checkout: {
      priceId: plan.paddlePriceId,
      customerId,
      customData: { organizationId: organization.id, userId: user.id },
    },
  };
}

/**
 * Opens the Paddle customer portal so the org can update payment methods,
 * download invoices, or cancel — never handled directly by Aegis. The
 * portal URL is fetched fresh each time because Paddle's are short-lived.
 */
export async function createPortalSessionAction(): Promise<BillingActionState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: NOT_CONFIGURED_ERROR };
  }

  if (!organization.paddleCustomerId) {
    return { error: "This organization doesn't have a subscription yet — subscribe to a plan first." };
  }

  const portalUrl = await getCustomerPortalUrl(organization.paddleCustomerId, organization.paddleSubscriptionId);
  if (!portalUrl) {
    return { error: "Could not open the billing portal right now. Please try again shortly." };
  }

  redirect(portalUrl);
}

/**
 * Cancels the organization's subscription at the end of the current billing
 * period — access continues until then. The organization's own plan/status
 * columns are updated by the webhook once Paddle confirms the change, not
 * by this action directly, so a crash between the API call succeeding and
 * this function returning can never leave Aegis's copy of the state wrong
 * for long.
 */
export async function cancelSubscriptionAction(): Promise<BillingActionState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: NOT_CONFIGURED_ERROR };
  }

  if (!organization.paddleSubscriptionId) {
    return { error: "This organization doesn't have an active subscription to cancel." };
  }

  try {
    await cancelPaddleSubscription(organization.paddleSubscriptionId);
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "billing_cancel_action_failed",
        organizationId: organization.id,
        error: describePaddleError(error),
      })
    );
    return { error: "Could not cancel the subscription right now. Please try again shortly." };
  }

  // Reflect the pending cancellation immediately rather than waiting for the
  // webhook round trip — the webhook will overwrite this with Paddle's own
  // authoritative state regardless.
  await prisma.organization.update({
    where: { id: organization.id },
    data: { cancelAtPeriodEnd: true },
  });

  revalidatePath("/settings/billing");
  return {};
}

/**
 * Switches the organization to a different paid plan (upgrade or downgrade),
 * billing/crediting the difference immediately. Same server-side price
 * resolution guarantee as checkout: the client sends a plan id, never a
 * price.
 */
export async function changeSubscriptionPlanAction(planId: string): Promise<BillingActionState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  if (!isBillingConfigured()) {
    return { error: NOT_CONFIGURED_ERROR };
  }

  if (!organization.paddleSubscriptionId) {
    return { error: "This organization doesn't have an active subscription to change. Subscribe to a plan first." };
  }

  const plan = PLANS[planId as PlanId];
  if (!plan || planId === "free" || planId === "enterprise" || !plan.paddlePriceId) {
    return { error: "This plan isn't available for self-serve checkout. Contact us instead." };
  }

  try {
    await changePaddleSubscriptionPlan(organization.paddleSubscriptionId, plan.paddlePriceId);
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "billing_change_plan_action_failed",
        organizationId: organization.id,
        error: describePaddleError(error),
      })
    );
    return { error: "Could not change the plan right now. Please try again shortly." };
  }

  revalidatePath("/settings/billing");
  return {};
}
