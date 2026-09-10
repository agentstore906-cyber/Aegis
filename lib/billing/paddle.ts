import "server-only";

import { Paddle, Environment, ApiError, type EventEntity } from "@paddle/paddle-node-sdk";

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

export type PaddleEnv = "sandbox" | "production";

/** Trim + lower-case `PADDLE_ENVIRONMENT`; return it only if it's a value we recognise. */
function explicitPaddleEnv(): PaddleEnv | null {
  const value = process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase();
  return value === "production" || value === "sandbox" ? value : null;
}

/** Which Paddle environment a credential belongs to, inferred from its prefix (`null` = can't tell). */
function classifyCredential(
  value: string | undefined,
  productionPrefix: string,
  sandboxPrefix: string
): PaddleEnv | null {
  if (!value) return null;
  if (value.startsWith(productionPrefix)) return "production";
  if (value.startsWith(sandboxPrefix)) return "sandbox";
  return null;
}

/**
 * The environment the configured API key + client token physically belong
 * to. Paddle live credentials (`pdl_live_…` / `live_…`) only authenticate
 * against the production endpoint and sandbox credentials (`pdl_sdbx_…` /
 * `test_…`) only against sandbox — there is no overlap. Returns `null` when
 * nothing can be inferred or the two credentials disagree.
 */
function paddleEnvFromCredentials(): PaddleEnv | null {
  const signals = [
    classifyCredential(process.env.PADDLE_API_KEY, "pdl_live_", "pdl_sdbx_"),
    classifyCredential(process.env.PADDLE_CLIENT_TOKEN, "live_", "test_"),
  ].filter((signal): signal is PaddleEnv => signal !== null);

  if (signals.length === 0) return null;
  if (signals.every((s) => s === "production")) return "production";
  if (signals.every((s) => s === "sandbox")) return "sandbox";
  return null;
}

/**
 * Resolves the single Paddle environment every server SDK call — and the
 * value handed to Paddle.js via `GET /api/billing/config` — must use.
 *
 * `PADDLE_ENVIRONMENT` is authoritative when set to `production`/`sandbox`
 * (case- and whitespace-tolerant). The one exception: when it unambiguously
 * contradicts the configured credentials (e.g. it says `sandbox` but both
 * the API key and client token are live), the credentials win — a live key
 * sent to `sandbox-api.paddle.com` fails every request with
 * `authentication_failed`, which surfaces to the user as the generic
 * "Could not start checkout." So following a wrong env var there would
 * guarantee the outage this resolver exists to prevent. When
 * `PADDLE_ENVIRONMENT` is unset we infer from the credentials, falling back
 * to `sandbox` only when there's nothing to go on.
 *
 * `logPaddleEnvDiagnosticsOnce()` records a non-sensitive warning whenever
 * this resolver has to override or fall back, so a misconfigured deployment
 * is visible in logs without exposing any secret.
 */
export function resolvePaddleEnvironment(): PaddleEnv {
  const explicit = explicitPaddleEnv();
  const fromCredentials = paddleEnvFromCredentials();

  if (explicit && fromCredentials && explicit !== fromCredentials) {
    return fromCredentials;
  }
  return explicit ?? fromCredentials ?? "sandbox";
}

let envDiagnosticsLogged = false;

/**
 * Logs (once per process) a non-sensitive diagnostic when the Paddle
 * environment configuration is inconsistent. Never logs a key or token
 * value — only its environment class ("production"/"sandbox").
 */
export function logPaddleEnvDiagnosticsOnce(): void {
  if (envDiagnosticsLogged) return;
  envDiagnosticsLogged = true;

  const explicit = explicitPaddleEnv();
  const resolved = resolvePaddleEnvironment();
  const apiKeyClass = classifyCredential(process.env.PADDLE_API_KEY, "pdl_live_", "pdl_sdbx_");
  const tokenClass = classifyCredential(process.env.PADDLE_CLIENT_TOKEN, "live_", "test_");

  if (explicit && explicit !== resolved) {
    console.error(
      JSON.stringify({
        msg: "paddle_environment_override",
        resolvedEnvironment: resolved,
        detail:
          `PADDLE_ENVIRONMENT="${explicit}" contradicts the configured Paddle credentials ` +
          `(which are ${resolved}); using "${resolved}" so Paddle can authenticate. ` +
          `Update PADDLE_ENVIRONMENT to "${resolved}" in this environment.`,
      })
    );
    return;
  }

  const conflicts: string[] = [];
  if (apiKeyClass && apiKeyClass !== resolved) conflicts.push(`PADDLE_API_KEY is a ${apiKeyClass} key`);
  if (tokenClass && tokenClass !== resolved) conflicts.push(`PADDLE_CLIENT_TOKEN is a ${tokenClass} token`);
  if (conflicts.length > 0) {
    console.error(
      JSON.stringify({
        msg: "paddle_environment_mismatch",
        resolvedEnvironment: resolved,
        detail:
          `${conflicts.join("; ")}, which cannot authenticate against the ${resolved} Paddle endpoint. ` +
          `Set PADDLE_ENVIRONMENT, PADDLE_API_KEY and PADDLE_CLIENT_TOKEN to the same Paddle environment.`,
      })
    );
  }
}

/** Non-sensitive shape of a caught error, safe to log or attach to a diagnostic. */
export type SafePaddleError = { name: string; code?: string; type?: string; message: string };

/**
 * Extracts a safe, non-sensitive description of a caught error. For a
 * Paddle `ApiError` this is the error `type`/`code`/`detail` — Paddle's own
 * generic API vocabulary (e.g. `authentication_failed`,
 * `customer_already_exists`), never a key, token or card value.
 */
export function describePaddleError(error: unknown): SafePaddleError {
  if (error instanceof ApiError) {
    return {
      name: "PaddleApiError",
      code: error.code,
      type: error.type,
      message: error.detail || error.message,
    };
  }
  if (error instanceof Error) return { name: error.name || "Error", message: error.message };
  return { name: "UnknownError", message: typeof error === "string" ? error : "Unknown error" };
}

/**
 * Paddle error codes that mean the request will *never* succeed until a
 * human changes the Paddle/deployment configuration — as opposed to a
 * transient outage worth retrying. `forbidden` is the one that bites
 * silently: Paddle returns it (HTTP 403, `type: "request_error"`) when the
 * `PADDLE_API_KEY` authenticates fine but lacks the permission the call
 * needs (Paddle keys are scoped per-resource, and a freshly-minted key has
 * *no* permissions until they're granted in Paddle → Developer tools → API
 * keys). `authentication_*` mean the key itself is wrong for the resolved
 * environment. All of these surface to the user as the generic "Could not
 * start checkout" — this predicate lets the server log say which it was.
 */
const PADDLE_MISCONFIG_CODES = new Set([
  "forbidden",
  "authentication_failed",
  "authentication_missing",
  "authentication_malformed",
  "invalid_token",
  "not_found", // e.g. a price id that doesn't exist in the resolved catalog/environment
]);

/** True when a caught error is a Paddle misconfiguration (bad/under-scoped key, wrong environment, missing catalog id) rather than a retryable blip. */
export function isPaddleMisconfigurationError(error: unknown): boolean {
  return error instanceof ApiError && Boolean(error.code) && PADDLE_MISCONFIG_CODES.has(error.code);
}

function paddleEnvironment(): Environment {
  return resolvePaddleEnvironment() === "production" ? Environment.production : Environment.sandbox;
}

/** Lazily-constructed singleton — never instantiated unless billing is actually used. */
export function getPaddleClient(): Paddle {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("Paddle is not configured (PADDLE_API_KEY is missing).");
  logPaddleEnvDiagnosticsOnce();
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

  try {
    const created = await paddle.customers.create({
      email: params.email,
      name: params.name,
      customData: { organizationId: params.organizationId },
    });
    return created.id;
  } catch (error) {
    // Paddle rejects a second customer with the same email
    // (`customer_already_exists`). That is a routine state, not a bug:
    // Paddle itself mints a customer the first time an email reaches
    // checkout, so a returning user whose organization has no stored
    // `paddleCustomerId` lands here every time. Recover by resolving the
    // existing customer by email rather than failing checkout outright.
    if (error instanceof ApiError && error.code === "customer_already_exists") {
      const existingId = await findPaddleCustomerIdByEmail(paddle, params.email);
      if (existingId) return existingId;
    }
    throw error;
  }
}

/** Resolves an existing Paddle customer id by email — prefers an active record over an archived one. */
async function findPaddleCustomerIdByEmail(paddle: Paddle, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let archivedMatch: string | null = null;
  for await (const customer of paddle.customers.list({ email: [email] })) {
    if (customer.email?.toLowerCase() !== target) continue;
    if (customer.status === "active") return customer.id;
    archivedMatch ??= customer.id;
  }
  return archivedMatch;
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
    console.error(JSON.stringify({ msg: "paddle_portal_session_failed", customerId, error: describePaddleError(error) }));
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
