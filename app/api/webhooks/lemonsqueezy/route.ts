import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { isBillingConfigured, verifyWebhookSignature } from "@/lib/billing/lemonsqueezy";
import { syncSubscriptionState, type LemonSqueezySubscriptionAttributes } from "@/lib/billing/sync";

/**
 * Lemon Squeezy webhook receiver.
 *
 * Every mutation is gated behind HMAC-SHA256 signature verification — the
 * body is never parsed until `verifyWebhookSignature` succeeds. Lemon
 * Squeezy payloads carry no stable event id, so replays are deduplicated
 * on a deterministic digest of (event name + subscription id + the
 * resource's `updated_at`); a genuine retry sends a byte-identical body and
 * therefore hits the same key. Organization association comes from the
 * `custom_data` Aegis itself set at checkout, verified against a real row,
 * with a fallback to the stored customer/subscription id — never from
 * anything else in the payload.
 *
 * Returns 200 once the event is durably recorded as processed, 400 for a
 * bad signature or unparseable body, 404 when billing isn't configured, and
 * 500 (so Lemon Squeezy retries) if handling throws midway.
 */

const SUBSCRIPTION_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_failed",
  "subscription_payment_success",
  "subscription_payment_recovered",
]);

type LemonSqueezyWebhookBody = {
  meta?: { event_name?: string; custom_data?: { organization_id?: string; user_id?: string } };
  data?: {
    id?: string;
    attributes?: LemonSqueezySubscriptionAttributes;
  };
};

function dedupKey(eventName: string, resourceId: string, updatedAt: string | undefined): string {
  return crypto
    .createHash("sha256")
    .update(`${eventName}:${resourceId}:${updatedAt ?? ""}`)
    .digest("hex");
}

async function resolveOrganizationId(body: LemonSqueezyWebhookBody): Promise<string | null> {
  const claimed = body.meta?.custom_data?.organization_id;
  if (claimed) {
    const org = await prisma.organization.findUnique({ where: { id: claimed }, select: { id: true } });
    if (org) return org.id;
  }

  const attrs = body.data?.attributes;
  if (attrs?.customer_id != null) {
    const org = await prisma.organization.findFirst({
      where: { lemonSqueezyCustomerId: String(attrs.customer_id) },
      select: { id: true },
    });
    if (org) return org.id;
  }

  if (body.data?.id) {
    const org = await prisma.organization.findFirst({
      where: { lemonSqueezySubscriptionId: String(body.data.id) },
      select: { id: true },
    });
    if (org) return org.id;
  }

  return null;
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingConfigured() || !process.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    // Nothing to process; 404 (not 200) makes a misconfigured endpoint
    // visibly fail in the Lemon Squeezy dashboard rather than silently
    // "succeeding" while doing nothing.
    return new Response("Not found", { status: 404 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error(JSON.stringify({ msg: "lemonsqueezy_webhook_signature_invalid" }));
    return new Response("Invalid signature", { status: 400 });
  }

  let body: LemonSqueezyWebhookBody;
  try {
    body = JSON.parse(rawBody) as LemonSqueezyWebhookBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventName = body.meta?.event_name ?? request.headers.get("x-event-name") ?? "";
  const resourceId = body.data?.id;
  if (!eventName || !resourceId) {
    return new Response("Missing event name or resource id", { status: 400 });
  }

  // Events we don't act on (e.g. order_created, license_key_*) are still
  // acknowledged so Lemon Squeezy doesn't retry them forever.
  if (!SUBSCRIPTION_EVENTS.has(eventName)) {
    return new Response(null, { status: 200 });
  }

  const key = dedupKey(eventName, resourceId, body.data?.attributes?.updated_at ?? undefined);
  const alreadyProcessed = await prisma.billingWebhookEvent.findUnique({ where: { id: key } });
  if (alreadyProcessed) {
    return new Response(null, { status: 200 });
  }

  try {
    const organizationId = await resolveOrganizationId(body);
    if (organizationId) {
      await syncSubscriptionState(organizationId, resourceId, body.data?.attributes ?? {}, eventName);
    } else {
      console.error(
        JSON.stringify({ msg: "lemonsqueezy_webhook_no_org_match", eventName, resourceId })
      );
    }
  } catch (error) {
    // Don't record the event as processed — let Lemon Squeezy retry.
    console.error(
      JSON.stringify({ msg: "lemonsqueezy_webhook_handling_failed", eventName, resourceId, error: String(error) })
    );
    return new Response("Webhook handling failed", { status: 500 });
  }

  await prisma.billingWebhookEvent.create({ data: { id: key, type: eventName } });
  return new Response(null, { status: 200 });
}
