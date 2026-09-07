import "server-only";

import { Paddle, Environment, type EventEntity } from "@paddle/paddle-node-sdk";

import { PLANS, DEFAULT_PLAN_ID, type PlanId } from "@/lib/billing/plans";

/**
 * Paddle Billing is an optional integration — this app boots and runs fully
 * without it configured (see docs/deployment.md). Every caller checks
 * `isBillingConfigured()` and surfaces an honest "billing isn't configured
 * in this environment" state rather than crashing on a missing env var.
 *
 * Uses the official `@paddle/paddle-node-sdk` server SDK. `PADDLE_API_KEY`
 * is a secret and is never sent to the client.
 *
 * New checkouts use Paddle's client-side overlay (Paddle.js), not a
 * server-created Transaction redirect: Paddle Billing requires a "default
 * payment link" (an approved domain that itself embeds Paddle.js) before
 * `transactions.create()` will return a `checkout.url` at all, so a pure
 * server-redirect flow either fails outright or can't carry a dynamic
 * per-request return URL. The overlay avoids both problems — see
 * `app/api/billing/config/route.ts` (hands the browser the publishable
 * `PADDLE_CLIENT_TOKEN`, never `PADDLE_API_KEY`) and
 * `components/settings/paddle-checkout-provider.tsx`. Price resolution
 * still happens here, server-side, from `PLANS` — the client only ever
 * receives the one price id this session's plan selection resolved to.
 */

let cachedClient: Paddle | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY);
}

function paddleEnvironment(): Environment {
  return process.env.PADDLE_ENVIRONMENT === "production" ? Environment.production : Environment.sandbox;
}

/** Lazily-constructed singleton — never instantiated unless billing is actually used. */
export function getPaddleClient(): Paddle {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("Paddle is not configured (PADDLE_API_KEY is missing).");
  if (!cachedClient) {
    cachedClient = new Paddle(apiKey, { environment: paddleEnvironment() });
  }
  return cachedClient;
}

/** Canonical Aegis billing states, mapped from Paddle's subscription status vocabulary. */
export type BillingStatus = "active" | "trialing" | "past_due" | "paused" | "cancelled" | "expired";

const PADDLE_STATUS_MAP: Record<string, BillingStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  paused: "paused",
  canceled: "cancelled",
};

export function mapSubscriptionStatus(paddleStatus: string | undefined): BillingStatus {
  return PADDLE_STATUS_MAP[paddleStatus ?? ""] ?? "expired";
}

/**
 * Whether a subscription in this status still grants its paid plan.
 *
 * Paddle has no "cancelled but access continues until period end" status:
 * a pending cancellation is a `scheduled_change` on an
 * otherwise `active`/`trialing`/`past_due` subscription (see
 * lib/billing/sync.ts, which derives `cancelAtPeriodEnd` from that), and the
 * status only flips to `canceled` once the subscription has actually ended.
 * So `cancelled` here must NOT grant paid access — `past_due`/`trialing` do,
 * to cover the dunning/trial window. `paused`/`expired` do not.
 */
export function statusGrantsPaidPlan(status: BillingStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/** Reverse lookup: which configured plan does this Paddle price id map to? Unknown -> free. */
export function planIdForPriceId(priceId: string | undefined | null): PlanId {
  if (!priceId) return DEFAULT_PLAN_ID;
  const match = (Object.keys(PLANS) as PlanId[]).find((id) => PLANS[id].paddlePriceId === priceId);
  return match ?? DEFAULT_PLAN_ID;
}

/**
 * Finds or creates the Paddle customer for this organization. The stored
 * `paddleCustomerId` is trusted first and only re-created if it no longer
 * resolves (e.g. it was archived directly in the Paddle dashboard) — Paddle
 * has no natural per-organization key, so this cached id is what prevents a
 * new customer being minted on every checkout.
 */
export async function ensurePaddleCustomer(params: {
  existingCustomerId?: string | null;
  email: string;
  name: string;
  organizationId: string;
}): Promise<string> {
  const paddle = getPaddleClient();

  if (params.existingCustomerId) {
    try {
      const existing = await paddle.customers.get(params.existingCustomerId);
      if (existing) return existing.id;
    } catch {
      // Stored id no longer resolves — fall through and create a fresh one.
    }
  }

  const created = await paddle.customers.create({
    email: params.email,
    name: params.name,
    customData: { organizationId: params.organizationId },
  });
  return created.id;
}

/**
 * Fetches a fresh Paddle customer-portal URL. Portal session links are
 * short-lived, so this is always fetched on demand rather than stored.
 * Returns the general portal overview URL — from there the customer can
 * manage payment methods, view invoices, and cancel. Returns null if
 * billing isn't configured or the session can't be created.
 */
export async function getCustomerPortalUrl(customerId: string, subscriptionId?: string | null): Promise<string | null> {
  try {
    const paddle = getPaddleClient();
    const session = await paddle.customerPortalSessions.create(customerId, subscriptionId ? [subscriptionId] : []);
    return session.urls?.general?.overview ?? null;
  } catch (error) {
    console.error(JSON.stringify({ msg: "paddle_portal_session_failed", customerId, error: String(error) }));
    return null;
  }
}

/** Cancels a subscription at the end of the current billing period (not immediately) — the customer keeps access until then. */
export async function cancelPaddleSubscription(subscriptionId: string): Promise<void> {
  const paddle = getPaddleClient();
  await paddle.subscriptions.cancel(subscriptionId, { effectiveFrom: "next_billing_period" });
}

/** Switches a subscription to a different price, billing/crediting the difference immediately. */
export async function changePaddleSubscriptionPlan(subscriptionId: string, newPriceId: string): Promise<void> {
  const paddle = getPaddleClient();
  await paddle.subscriptions.update(subscriptionId, {
    items: [{ priceId: newPriceId, quantity: 1 }],
    prorationBillingMode: "prorated_immediately",
  });
}

/**
 * Verifies and parses a Paddle webhook. Uses the SDK's `webhooks.unmarshal`,
 * which checks the `Paddle-Signature` header (HMAC-SHA256 of `ts:rawBody`
 * under `PADDLE_WEBHOOK_SECRET`, constant-time compared) and enforces a
 * timestamp tolerance against replay. Returns null on any failure —
 * never throws into the route handler.
 */
export async function verifyAndUnmarshalWebhook(rawBody: string, signature: string | null): Promise<EventEntity | null> {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  try {
    const paddle = getPaddleClient();
    return await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch (error) {
    console.error(JSON.stringify({ msg: "paddle_webhook_verification_failed", error: String(error) }));
    return null;
  }
}
