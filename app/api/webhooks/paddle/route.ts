import { EventName } from "@paddle/paddle-node-sdk";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isBillingConfigured, verifyAndUnmarshalWebhook } from "@/lib/billing/paddle";
import { syncSubscriptionState, recordTransactionOutcome } from "@/lib/billing/sync";
import { UnmappedPriceError } from "@/lib/billing/subscription-decision";

/**
 * Paddle webhook receiver.
 *
 * Every mutation is gated behind `Paddle-Signature` verification (via the
 * official SDK's `webhooks.unmarshal`, see lib/billing/paddle.ts) — the body
 * is never trusted until that succeeds. Paddle notifications carry a stable
 * `event_id`, so replays are deduplicated directly on that id
 * (`BillingWebhookEvent` table); a genuine retry sends the same event id.
 * Organization association comes from the `custom_data` Aegis itself set
 * when opening the checkout overlay (see
 * lib/billing/actions.ts#createCheckoutSessionAction), verified against a
 * real row, with a fallback to the stored customer/subscription id — never
 * from anything else in the payload.
 *
 * Returns 200 once the event is durably recorded as processed, 400 for a
 * bad signature or unparseable body, 404 when billing isn't configured, and
 * 500 (so Paddle retries) if handling throws midway.
 */

const HANDLED_EVENTS = new Set<string>([
  EventName.SubscriptionCreated,
  EventName.SubscriptionUpdated,
  EventName.SubscriptionCanceled,
  // Lifecycle events carry the full subscription entity; its `status` (paused / active / past_due) drives access.
  EventName.SubscriptionPaused,
  EventName.SubscriptionResumed,
  EventName.SubscriptionPastDue,
  EventName.TransactionCompleted,
  EventName.TransactionPaymentFailed,
]);

/** How long a subscription event that matches no organization keeps being retried (by answering 500) before it is abandoned. */
const UNMATCHED_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Paddle's `occurred_at` as a Date, or null when absent/unparseable (then no ordering decision is made from it). */
function parseOccurredAt(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveOrganizationId(params: {
  customData: Record<string, unknown> | null | undefined;
  customerId: string | null | undefined;
  subscriptionId: string | null | undefined;
}): Promise<string | null> {
  const claimed =
    typeof params.customData?.organizationId === "string" ? params.customData.organizationId : undefined;
  if (claimed) {
    const org = await prisma.organization.findUnique({ where: { id: claimed }, select: { id: true } });
    if (org) return org.id;
  }

  if (params.customerId) {
    const org = await prisma.organization.findFirst({
      where: { paddleCustomerId: params.customerId },
      select: { id: true },
    });
    if (org) return org.id;
  }

  if (params.subscriptionId) {
    const org = await prisma.organization.findFirst({
      where: { paddleSubscriptionId: params.subscriptionId },
      select: { id: true },
    });
    if (org) return org.id;
  }

  return null;
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingConfigured() || !process.env.PADDLE_WEBHOOK_SECRET) {
    // Nothing to process; 404 (not 200) makes a misconfigured endpoint
    // visibly fail in the Paddle dashboard rather than silently "succeeding"
    // while doing nothing.
    return new Response("Not found", { status: 404 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("paddle-signature");

  const eventData = await verifyAndUnmarshalWebhook(rawBody, signature);
  if (!eventData) {
    console.error(JSON.stringify({ msg: "paddle_webhook_signature_invalid" }));
    return new Response("Invalid signature", { status: 400 });
  }

  if (!HANDLED_EVENTS.has(eventData.eventType)) {
    // Events we don't act on (customer.*, price.*, ...) are still
    // acknowledged so Paddle doesn't retry them forever.
    return new Response(null, { status: 200 });
  }

  const alreadyProcessed = await prisma.billingWebhookEvent.findUnique({ where: { id: eventData.eventId } });
  if (alreadyProcessed) {
    return new Response(null, { status: 200 });
  }

  const occurredAt = parseOccurredAt(eventData.occurredAt);

  try {
    switch (eventData.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionPastDue: {
        const data = eventData.data;
        const organizationId = await resolveOrganizationId({
          customData: data.customData,
          customerId: data.customerId,
          subscriptionId: data.id,
        });
        if (!organizationId) {
          // A subscription event that reaches no organization means a customer may be paying with no access. It is
          // NEVER recorded as processed: while recent it returns 500 so Paddle retries (the usual cause is a race that
          // heals within minutes); once old it is acknowledged without a dedupe row, so a manual replay from the
          // Paddle dashboard is still processed.
          const recent = occurredAt === null || Date.now() - occurredAt.getTime() < UNMATCHED_RETRY_WINDOW_MS;
          console.error(
            JSON.stringify({
              msg: recent ? "paddle_webhook_unmatched_will_retry" : "paddle_webhook_unmatched_abandoned",
              eventType: eventData.eventType,
              eventId: eventData.eventId,
              subscriptionId: data.id,
              customerId: data.customerId,
            })
          );
          return recent ? new Response("Organization not found; retry", { status: 500 }) : new Response(null, { status: 200 });
        }

        const priceId = data.items[0]?.price?.id ?? null;
        const scheduledCancel = data.scheduledChange?.action === "cancel";

        await syncSubscriptionState(
          organizationId,
          data.id,
          {
            status: data.status,
            customerId: data.customerId,
            priceId,
            cancelAtPeriodEnd: scheduledCancel,
            currentPeriodStart: data.currentBillingPeriod?.startsAt ?? undefined,
            currentPeriodEnd: data.currentBillingPeriod?.endsAt ?? data.canceledAt ?? undefined,
            occurredAt,
          },
          eventData.eventType
        );
        break;
      }

      case EventName.TransactionCompleted:
      case EventName.TransactionPaymentFailed: {
        const data = eventData.data;
        const organizationId = await resolveOrganizationId({
          customData: data.customData,
          customerId: data.customerId,
          subscriptionId: data.subscriptionId,
        });
        if (!organizationId) {
          console.error(
            JSON.stringify({ msg: "paddle_webhook_no_org_match", eventType: eventData.eventType, transactionId: data.id })
          );
          break;
        }

        await recordTransactionOutcome(
          organizationId,
          eventData.eventType === EventName.TransactionCompleted ? "succeeded" : "failed",
          eventData.eventType,
          { occurredAt, subscriptionId: data.subscriptionId }
        );
        break;
      }
    }
  } catch (error) {
    // Don't record the event as processed — let Paddle retry.
    if (error instanceof UnmappedPriceError) {
      // A PAID subscription whose price matches no configured plan: the plan was deliberately left untouched. Fix the
      // PADDLE_*_PRICE_ID configuration (or the repriced plan's id); the retry then applies the event.
      console.error(
        JSON.stringify({
          msg: "paddle_webhook_unmapped_price",
          eventType: eventData.eventType,
          eventId: eventData.eventId,
          subscriptionId: error.subscriptionId,
          priceIdPrefix: error.priceIdPrefix,
        })
      );
    } else {
      console.error(
        JSON.stringify({ msg: "paddle_webhook_handling_failed", eventType: eventData.eventType, error: String(error) })
      );
    }
    return new Response("Webhook handling failed", { status: 500 });
  }

  try {
    await prisma.billingWebhookEvent.create({ data: { id: eventData.eventId, type: eventData.eventType } });
  } catch (error) {
    // Two concurrent deliveries of the same event: the other one recorded it first. Applying is idempotent (events are
    // ordered and decided under a row lock), so this is success, not a reason for Paddle to retry.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  return new Response(null, { status: 200 });
}
