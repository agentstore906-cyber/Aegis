import "server-only";

import Stripe from "stripe";

/**
 * Stripe is an optional integration — this app must boot and run fully
 * without it configured (see docs/deployment.md). `getStripeClient()`
 * returns `null` rather than throwing when `STRIPE_SECRET_KEY` isn't set,
 * so every caller explicitly handles "billing isn't configured in this
 * environment" instead of the app crashing on a missing env var it
 * doesn't strictly require to run.
 */
let cachedClient: Stripe | null | undefined;

export function getStripeClient(): Stripe | null {
  if (cachedClient !== undefined) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  cachedClient = secretKey
    ? new Stripe(secretKey, {
        typescript: true,
      })
    : null;

  return cachedClient;
}

export function isBillingConfigured(): boolean {
  return getStripeClient() !== null;
}
