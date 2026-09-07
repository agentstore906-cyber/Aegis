import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";
import { DEFAULT_PLAN_ID } from "@/lib/billing/plans";
import { mapSubscriptionStatus, planIdForPriceId, statusGrantsPaidPlan } from "@/lib/billing/paddle";

/** The subset of a Paddle subscription notification this code reads. */
export interface PaddleSubscriptionAttributes {
  status?: string;
  customerId?: string | null;
  priceId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}

/**
 * Writes a Paddle subscription's current state onto the organization.
 * Idempotent by construction: it sets *absolute* values from the payload
 * (never deltas), so replaying an event, or events arriving out of order,
 * converge to whatever Paddle last reported. `plan` — the column Aegis
 * actually enforces entitlements against — drops to free the moment the
 * status stops granting a paid plan (paused/expired).
 */
export async function syncSubscriptionState(
  organizationId: string,
  subscriptionId: string,
  attributes: PaddleSubscriptionAttributes,
  eventName: string
): Promise<void> {
  const status = mapSubscriptionStatus(attributes.status);
  const planId = statusGrantsPaidPlan(status) ? planIdForPriceId(attributes.priceId) : DEFAULT_PLAN_ID;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: planId,
      paddleCustomerId: attributes.customerId ?? undefined,
      paddleSubscriptionId: subscriptionId,
      paddlePriceId: attributes.priceId ?? undefined,
      subscriptionStatus: status,
      billingInterval: "month",
      currentPeriodStart: attributes.currentPeriodStart ? new Date(attributes.currentPeriodStart) : undefined,
      currentPeriodEnd: attributes.currentPeriodEnd ? new Date(attributes.currentPeriodEnd) : null,
      cancelAtPeriodEnd: attributes.cancelAtPeriodEnd === true,
    },
  });

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "SYSTEM",
    eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
    entityType: "Organization",
    entityId: organizationId,
    action: "billing.subscription_synced",
    metadata: { plan: planId, status, event: eventName },
  });

  if (eventName === "subscription.created") {
    trackEvent("subscription_started", { organizationId });
  }
}

/**
 * Records the outcome of a single transaction (a renewal charge or the
 * initial checkout payment) against the organization's billing status.
 *
 * This deliberately never touches `plan` or the period fields — those stay
 * owned exclusively by `syncSubscriptionState`, which Paddle always sends a
 * companion `subscription.*` event for. A failed payment flips the status to
 * `past_due` immediately (rather than waiting on a possible later
 * `subscription.past_due` event) so the billing page reflects it as soon as
 * possible; a completed payment clears `past_due` back to `active` if that
 * was the prior state (dunning recovery). Both are idempotent no-ops if the
 * status already reflects the outcome.
 */
export async function recordTransactionOutcome(
  organizationId: string,
  outcome: "succeeded" | "failed",
  eventName: string
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true },
  });
  if (!organization) return;

  const nextStatus =
    outcome === "failed"
      ? "past_due"
      : organization.subscriptionStatus === "past_due"
        ? "active"
        : organization.subscriptionStatus;

  if (nextStatus !== organization.subscriptionStatus) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus: nextStatus },
    });
  }

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "SYSTEM",
    eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
    entityType: "Organization",
    entityId: organizationId,
    action: outcome === "failed" ? "billing.payment_failed" : "billing.payment_succeeded",
    metadata: { event: eventName },
  });
}
