import "server-only";

import crypto from "node:crypto";

import { PLANS, DEFAULT_PLAN_ID, type PlanId } from "@/lib/billing/plans";

/**
 * Lemon Squeezy is an optional integration — this app boots and runs fully
 * without it configured (see docs/deployment.md). Every caller checks
 * `isBillingConfigured()` and surfaces an honest "billing isn't configured
 * in this environment" state rather than crashing on a missing env var.
 *
 * Implemented with plain `fetch` against the documented REST API rather
 * than pulling in an SDK — the surface we use (create checkout, read one
 * subscription, verify a webhook HMAC) is small and stable.
 */

const LS_API = "https://api.lemonsqueezy.com/v1";

const JSON_API_HEADERS = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
} as const;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.LEMONSQUEEZY_API_KEY && process.env.LEMONSQUEEZY_STORE_ID);
}

/** Canonical Aegis billing states, mapped from Lemon Squeezy's subscription status vocabulary. */
export type BillingStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "paused"
  | "unpaid"
  | "cancelled"
  | "expired";

const LS_STATUS_MAP: Record<string, BillingStatus> = {
  on_trial: "trialing",
  active: "active",
  past_due: "past_due",
  paused: "paused",
  unpaid: "unpaid",
  cancelled: "cancelled",
  expired: "expired",
};

export function mapSubscriptionStatus(lemonSqueezyStatus: string | undefined): BillingStatus {
  return LS_STATUS_MAP[lemonSqueezyStatus ?? ""] ?? "expired";
}

/**
 * Whether a subscription in this status still grants its paid plan.
 * `cancelled` keeps access until the period ends (Lemon Squeezy keeps the
 * subscription valid until `ends_at`); `past_due`/`trialing` keep access
 * during the dunning/trial window. `paused`/`unpaid`/`expired` do not.
 */
export function statusGrantsPaidPlan(status: BillingStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due" || status === "cancelled";
}

/** Reverse lookup: which configured plan does this Lemon Squeezy variant id map to? Unknown -> free. */
export function planIdForVariant(variantId: string | number | undefined | null): PlanId {
  if (variantId === undefined || variantId === null) return DEFAULT_PLAN_ID;
  const asString = String(variantId);
  const match = (Object.keys(PLANS) as PlanId[]).find((id) => PLANS[id].lemonSqueezyVariantId === asString);
  return match ?? DEFAULT_PLAN_ID;
}

export interface CreateCheckoutParams {
  variantId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  redirectUrl: string;
}

/**
 * Creates a hosted Lemon Squeezy checkout and returns its URL. `custom`
 * carries only the Aegis organization/user id so the webhook can associate
 * the resulting subscription — never anything sensitive. The webhook, not
 * this call or the post-checkout redirect, is what actually grants the plan.
 */
export async function createLemonSqueezyCheckout(params: CreateCheckoutParams): Promise<string> {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!apiKey || !storeId) throw new Error("Lemon Squeezy is not configured.");

  const response = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: { ...JSON_API_HEADERS, Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: params.email,
            name: params.organizationName,
            custom: {
              organization_id: params.organizationId,
              user_id: params.userId,
            },
          },
          product_options: {
            redirect_url: params.redirectUrl,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(params.variantId) } },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      JSON.stringify({ msg: "lemonsqueezy_checkout_failed", status: response.status, detail: detail.slice(0, 500) })
    );
    throw new Error("Could not start checkout. Please try again in a moment.");
  }

  const json = (await response.json()) as { data?: { attributes?: { url?: string } } };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy did not return a checkout URL.");
  return url;
}

/**
 * Fetches a fresh Lemon Squeezy customer-portal URL for an existing
 * subscription. Portal URLs are short-lived, so this is always fetched on
 * demand rather than stored. Returns null if billing isn't configured or
 * the subscription can't be read.
 */
export async function getCustomerPortalUrl(subscriptionId: string): Promise<string | null> {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(`${LS_API}/subscriptions/${subscriptionId}`, {
    headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    console.error(
      JSON.stringify({ msg: "lemonsqueezy_subscription_fetch_failed", status: response.status, subscriptionId })
    );
    return null;
  }

  const json = (await response.json()) as {
    data?: { attributes?: { urls?: { customer_portal?: string } } };
  };
  return json.data?.attributes?.urls?.customer_portal ?? null;
}

/**
 * Verifies a Lemon Squeezy webhook. The signature is a hex HMAC-SHA256 of
 * the raw request body under `LEMONSQUEEZY_WEBHOOK_SECRET`, sent in the
 * `X-Signature` header. Constant-time comparison; any missing piece fails
 * closed.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
