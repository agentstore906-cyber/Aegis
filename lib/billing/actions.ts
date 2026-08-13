"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageBilling } from "@/lib/billing/authorization";
import { getStripeClient } from "@/lib/billing/stripe";
import { PLANS, type PlanId } from "@/lib/billing/plans";

export type BillingActionState = { error?: string };

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/**
 * Starts a Stripe Checkout session for the given plan. The price ID is
 * always resolved server-side from `PLANS` — the client only ever sends a
 * plan *id* ("growth"), never a price or amount, so a tampered request
 * can at most select a different *configured* plan, never an arbitrary
 * price.
 */
export async function createCheckoutSessionAction(planId: string): Promise<BillingActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return { error: "Billing is not configured in this environment. See docs/deployment.md." };
  }

  const plan = PLANS[planId as PlanId];
  if (!plan || !plan.stripePriceId) {
    return { error: "This plan isn't available for self-serve checkout. Contact us instead." };
  }

  let customerId = organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: organization.name,
      metadata: { organizationId: organization.id },
    });
    customerId = customer.id;
    await prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${baseUrl()}/settings/billing?checkout=success`,
    cancel_url: `${baseUrl()}/settings/billing?checkout=cancelled`,
    client_reference_id: organization.id,
    metadata: { organizationId: organization.id, planId: plan.id },
  });

  if (!session.url) {
    return { error: "Stripe did not return a checkout URL. Please try again." };
  }

  redirect(session.url);
}

/** Opens the Stripe-hosted customer portal so the org can manage payment methods, invoices, and cancellation — never handled directly by Aegis. */
export async function createPortalSessionAction(): Promise<BillingActionState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageBilling(role)) {
    return { error: "You don't have permission to manage billing." };
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return { error: "Billing is not configured in this environment. See docs/deployment.md." };
  }

  if (!organization.stripeCustomerId) {
    return { error: "This organization doesn't have a billing account yet — upgrade first." };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${baseUrl()}/settings/billing`,
  });

  redirect(session.url);
}
