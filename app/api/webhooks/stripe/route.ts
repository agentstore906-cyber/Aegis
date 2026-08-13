import type Stripe from "stripe";

import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/billing/stripe";
import { PLANS, DEFAULT_PLAN_ID, type PlanId } from "@/lib/billing/plans";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";

/** Reverse lookup: which configured plan does this Stripe price belong to? Falls back to the free plan id if the price isn't recognized (e.g. a price removed from config after being sold) rather than throwing. */
function planIdForPrice(priceId: string | undefined): PlanId {
  if (!priceId) return DEFAULT_PLAN_ID;
  const match = (Object.keys(PLANS) as PlanId[]).find((id) => PLANS[id].stripePriceId === priceId);
  return match ?? DEFAULT_PLAN_ID;
}

async function applySubscriptionState(organizationId: string, subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price.id;
  const planId = planIdForPrice(priceId);
  const currentPeriodEndUnix = subscription.items.data[0]?.current_period_end;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: planId,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: currentPeriodEndUnix ? new Date(currentPeriodEndUnix * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "SYSTEM",
    eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
    entityType: "Organization",
    entityId: organizationId,
    action: "billing.subscription_synced",
    metadata: { plan: planId, status: subscription.status },
  });
}

/**
 * Stripe webhook receiver. Every mutation is gated behind signature
 * verification (never trusts the body until `constructEvent` succeeds)
 * and deduplicated on Stripe's own event id via `StripeWebhookEvent`
 * (Stripe explicitly documents "at least once" delivery, so a replay must
 * be a safe no-op, not a re-applied state change). Organization
 * association comes from `client_reference_id`/`metadata.organizationId`
 * (set by Aegis itself at checkout time — see lib/billing/actions.ts) or
 * the Stripe customer id already stored on the org, never from anything
 * else in the payload.
 */
export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    // Billing isn't configured in this environment — there's nothing to
    // process, and returning 404 (not 200) makes a misconfigured webhook
    // endpoint visibly fail in the Stripe dashboard rather than silently
    // "succeeding" while doing nothing.
    return new Response("Not found", { status: 404 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error(JSON.stringify({ msg: "stripe_webhook_signature_invalid", error: String(error) }));
    return new Response("Invalid signature", { status: 400 });
  }

  const alreadyProcessed = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (alreadyProcessed) {
    return new Response(null, { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = session.client_reference_id ?? session.metadata?.organizationId;
        if (organizationId && typeof session.subscription === "string") {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await applySubscriptionState(organizationId, subscription);
          trackEvent("subscription_started", { organizationId });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const organization = await prisma.organization.findFirst({
          where: { stripeCustomerId: subscription.customer as string },
        });
        if (organization) {
          await applySubscriptionState(organization.id, subscription);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const organization = await prisma.organization.findFirst({
          where: { stripeCustomerId: subscription.customer as string },
        });
        if (organization) {
          await prisma.organization.update({
            where: { id: organization.id },
            data: {
              plan: DEFAULT_PLAN_ID,
              subscriptionStatus: "canceled",
              cancelAtPeriodEnd: false,
              currentPeriodEnd: null,
            },
          });
          await recordAuditEvent(prisma, {
            organizationId: organization.id,
            actorType: "SYSTEM",
            eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
            entityType: "Organization",
            entityId: organization.id,
            action: "billing.subscription_canceled",
            metadata: { plan: DEFAULT_PLAN_ID },
          });
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const organization = await prisma.organization.findFirst({
          where: { stripeCustomerId: invoice.customer as string },
        });
        if (organization) {
          await prisma.organization.update({
            where: { id: organization.id },
            data: { subscriptionStatus: event.type === "invoice.paid" ? "active" : "past_due" },
          });
        }
        break;
      }

      default:
        // Other event types are intentionally ignored — still recorded as
        // processed below so a Stripe dashboard "resend" doesn't loop.
        break;
    }
  } catch (error) {
    // Do not record this event id as processed if handling failed — a
    // subsequent Stripe retry should get another chance to apply it.
    console.error(JSON.stringify({ msg: "stripe_webhook_handling_failed", eventId: event.id, type: event.type, error: String(error) }));
    return new Response("Webhook handling failed", { status: 500 });
  }

  await prisma.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } });

  return new Response(null, { status: 200 });
}
