"use server";

import { redirect, unstable_rethrow } from "next/navigation";
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
  isPaddleMisconfigurationError,
  isValidPaddlePriceId,
  logPaddleEnvDiagnosticsOnce,
  resolvePaddleEnvironmentForLog,
  type SafePaddleError,
} from "@/lib/billing/paddle";
import { PLANS, type PlanId } from "@/lib/billing/plans";

export type BillingActionState = { error?: string };

const NOT_CONFIGURED_ERROR = "Billing is not configured in this environment. See docs/deployment.md.";
/** The one message the user ever sees for a failed checkout start — the real cause goes to the server log via `logCheckoutDiagnostic`. */
const GENERIC_CHECKOUT_ERROR = "Could not start checkout. Please try again in a moment.";

/** Which step of `createCheckoutSessionAction` a failure happened at — attached to every checkout diagnostic. */
type CheckoutStage = "auth" | "config" | "customer_create" | "persist_customer";

const MISCONFIG_ACTION_HINT =
  "Paddle rejected an authenticated request. Grant the PADDLE_API_KEY the customer/transaction/subscription " +
  "permissions in Paddle → Developer tools → API keys (or issue a new key with them) and confirm PADDLE_API_KEY, " +
  "PADDLE_CLIENT_TOKEN and PADDLE_ENVIRONMENT all point at the same Paddle environment.";

/**
 * Emits the one structured, secret-free checkout diagnostic (Phase 10
 * shape) to the server log. Contains no key, token, cookie, card value or
 * price id — only Paddle's own generic error vocabulary and non-sensitive
 * metadata. This is what turns "Could not start checkout" into an
 * actionable Vercel Runtime Log line.
 */
function logCheckoutDiagnostic(fields: {
  stage: CheckoutStage;
  organizationId: string | null;
  planId: string;
  misconfigured?: boolean;
  error?: SafePaddleError;
  priceIdPrefix?: string | null;
  detail?: string;
}): void {
  const { stage, organizationId, planId, misconfigured, error, priceIdPrefix, detail } = fields;
  console.error(
    JSON.stringify({
      msg: misconfigured ? "billing_checkout_misconfigured" : "billing_checkout_failed",
      operation: "checkout_start",
      provider: "paddle",
      environment: resolvePaddleEnvironmentForLog(),
      paddleEnvironmentVar: process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase() ?? null,
      stage,
      organizationId,
      planId,
      ...(priceIdPrefix !== undefined ? { priceIdPrefix } : {}),
      ...(detail ? { detail } : {}),
      ...(error
        ? {
            paddleErrorName: error.name,
            paddleType: error.type ?? null,
            paddleCode: error.code ?? null,
            paddleMessage: error.message,
          }
        : {}),
      ...(misconfigured ? { action: MISCONFIG_ACTION_HINT } : {}),
    })
  );
}

/**
 * Wraps a billing action so an unexpected throw — a Neon/Prisma runtime
 * error inside `requireActiveOrganization()`, a config error, a Paddle SDK
 * error from a path that isn't individually wrapped — becomes a logged,
 * safe `{ error }` state instead of escaping to the dashboard error
 * boundary (the bare "something went wrong" screen). Framework control-flow
 * (`redirect()` / `notFound()`) is always rethrown.
 */
async function guardBillingAction(
  operation: string,
  fallbackError: string,
  run: () => Promise<BillingActionState>
): Promise<BillingActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      JSON.stringify({
        msg: "billing_action_uncaught",
        operation,
        provider: "paddle",
        environment: resolvePaddleEnvironmentForLog(),
        paddleEnvironmentVar: process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase() ?? null,
        error: describePaddleError(error),
      })
    );
    return { error: fallbackError };
  }
}

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
  // The ENTIRE body runs inside this guard. A server action that throws
  // (rather than returning `{ error }`) escapes to the dashboard error
  // boundary — the user sees a bare "something went wrong" and the operator
  // gets nothing actionable. The pre-guard version left the auth + Prisma
  // section (`requireActiveOrganization`) and the Paddle SDK client
  // construction outside any try/catch, so a Neon runtime error or a
  // config error there did exactly that. Now every failure is logged with
  // the stage it happened at and returned as a clean error state.
  let stage: CheckoutStage = "auth";
  let organizationId: string | null = null;

  try {
    const { organization, user, role } = await requireActiveOrganization();
    organizationId = organization.id;

    if (!canManageBilling(role)) {
      return { error: "You don't have permission to manage billing." };
    }
    if (!isBillingConfigured()) {
      return { error: NOT_CONFIGURED_ERROR };
    }

    // Non-sensitive Paddle config snapshot to the log on the first checkout
    // of each server instance — makes a misconfigured production deployment
    // obvious in Vercel Runtime Logs without logging any secret.
    logPaddleEnvDiagnosticsOnce();

    stage = "config";
    const plan = PLANS[planId as PlanId];
    if (!plan || planId === "free" || planId === "enterprise" || !plan.paddlePriceId) {
      return { error: "This plan isn't available for self-serve checkout. Contact us instead." };
    }

    // The client only ever sends a plan *id*; the price id is resolved here
    // from env. Validate its shape before handing it to the browser: a
    // product id (`pro_…`) pasted into PADDLE_STARTUP_PRICE_ID, a sandbox
    // price in a live deployment, or a value with stray whitespace would
    // otherwise fail inside `Paddle.Checkout.open()` client-side with only
    // the generic error and nothing in the server log.
    const priceId = plan.paddlePriceId.trim();
    if (!isValidPaddlePriceId(priceId)) {
      logCheckoutDiagnostic({
        stage: "config",
        organizationId,
        planId,
        priceIdPrefix: priceId.slice(0, 4) || null,
        detail: "configured Paddle price id is not a valid `pri_…` id — check this plan's PADDLE_*_PRICE_ID env var",
      });
      return { error: GENERIC_CHECKOUT_ERROR };
    }

    stage = "customer_create";
    const customerId = await ensurePaddleCustomer({
      existingCustomerId: organization.paddleCustomerId,
      email: user.email,
      name: organization.name,
      organizationId: organization.id,
    });

    // Cache the customer id immediately so a second checkout attempt (or the
    // portal button) reuses it rather than minting a new Paddle customer —
    // the webhook will also set this, but doesn't fire until payment.
    if (customerId !== organization.paddleCustomerId) {
      stage = "persist_customer";
      await prisma.organization.update({
        where: { id: organization.id },
        data: { paddleCustomerId: customerId },
      });
    }

    return {
      checkout: {
        priceId,
        customerId,
        customData: { organizationId: organization.id, userId: user.id },
      },
    };
  } catch (error) {
    // `requireActiveOrganization()` throws `NEXT_REDIRECT` for a user with
    // no org — that must propagate, not be swallowed.
    unstable_rethrow(error);

    // The user only ever sees GENERIC_CHECKOUT_ERROR; the structured log
    // carries the stage plus Paddle's own safe error vocabulary
    // (type/code/detail — never a key, token or card value), so an operator
    // can tell a misconfiguration (`forbidden` → under-scoped API key;
    // `authentication_failed` → wrong PADDLE_ENVIRONMENT / key) from a Neon
    // runtime error (`stage: "auth"`) from a transient Paddle outage.
    logCheckoutDiagnostic({
      stage,
      organizationId,
      planId,
      misconfigured: isPaddleMisconfigurationError(error),
      error: describePaddleError(error),
    });
    return { error: GENERIC_CHECKOUT_ERROR };
  }
}

/**
 * Opens the Paddle customer portal so the org can update payment methods,
 * download invoices, or cancel — never handled directly by Aegis. The
 * portal URL is fetched fresh each time because Paddle's are short-lived.
 */
export async function createPortalSessionAction(): Promise<BillingActionState> {
  return guardBillingAction(
    "portal_session",
    "Could not open the billing portal right now. Please try again shortly.",
    async () => {
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

      const portalUrl = await getCustomerPortalUrl(
        organization.paddleCustomerId,
        organization.paddleSubscriptionId
      );
      if (!portalUrl) {
        return { error: "Could not open the billing portal right now. Please try again shortly." };
      }

      redirect(portalUrl);
    }
  );
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
  return guardBillingAction(
    "cancel_subscription",
    "Could not cancel the subscription right now. Please try again shortly.",
    async () => {
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

      // Reflect the pending cancellation immediately rather than waiting for
      // the webhook round trip — the webhook will overwrite this with
      // Paddle's own authoritative state regardless.
      await prisma.organization.update({
        where: { id: organization.id },
        data: { cancelAtPeriodEnd: true },
      });

      revalidatePath("/settings/billing");
      return {};
    }
  );
}

/**
 * Switches the organization to a different paid plan (upgrade or downgrade),
 * billing/crediting the difference immediately. Same server-side price
 * resolution guarantee as checkout: the client sends a plan id, never a
 * price.
 */
export async function changeSubscriptionPlanAction(planId: string): Promise<BillingActionState> {
  return guardBillingAction(
    "change_plan",
    "Could not change the plan right now. Please try again shortly.",
    async () => {
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

      const newPriceId = plan.paddlePriceId.trim();
      if (!isValidPaddlePriceId(newPriceId)) {
        console.error(
          JSON.stringify({
            msg: "billing_change_plan_bad_price_id",
            organizationId: organization.id,
            planId,
            priceIdPrefix: newPriceId.slice(0, 4) || null,
          })
        );
        return { error: "Could not change the plan right now. Please try again shortly." };
      }

      try {
        await changePaddleSubscriptionPlan(organization.paddleSubscriptionId, newPriceId);
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
  );
}
