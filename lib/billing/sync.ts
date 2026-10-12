import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";
import { attributeToScanner } from "@/lib/scanner/analytics";
import type { Prisma } from "@prisma/client";
import { mapSubscriptionStatus } from "@/lib/billing/paddle";
import { decideSubscriptionSync, decideTransactionOutcome } from "@/lib/billing/subscription-decision";

/** The subset of a Paddle subscription notification this code reads. */
export interface PaddleSubscriptionAttributes {
  status?: string;
  customerId?: string | null;
  priceId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  /** Paddle's `occurred_at` for this event; drives stale-event rejection (see subscription-decision.ts). */
  occurredAt?: Date | null;
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
  eventName: string,
  now: Date = new Date()
): Promise<SyncOutcome> {
  const status = mapSubscriptionStatus(attributes.status);

  // One transaction per event, serialized per organization by a row lock: two events for the same organization
  // (concurrent deliveries, retries) are decided one after the other against the committed state, so a stale event
  // can never slip in between another event's read and write.
  const outcome = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const org = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!org) return { applied: false, reason: "organization_missing" } as const;

    const decision = decideSubscriptionSync(
      org,
      { eventName, subscriptionId, status, priceId: attributes.priceId, occurredAt: attributes.occurredAt ?? null },
      now
    );
    if (decision.kind === "skip") return { applied: false, reason: decision.reason } as const;

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        plan: decision.plan,
        paddleCustomerId: attributes.customerId ?? undefined,
        paddleSubscriptionId: subscriptionId,
        paddlePriceId: attributes.priceId ?? undefined,
        subscriptionStatus: status,
        billingInterval: "month",
        currentPeriodStart: attributes.currentPeriodStart ? new Date(attributes.currentPeriodStart) : undefined,
        currentPeriodEnd: attributes.currentPeriodEnd ? new Date(attributes.currentPeriodEnd) : null,
        cancelAtPeriodEnd: attributes.cancelAtPeriodEnd === true,
        billingEventAt: decision.billingEventAt,
        planDowngradedAt: decision.planDowngradedAt,
      },
    });

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "SYSTEM",
      eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
      entityType: "Organization",
      entityId: organizationId,
      action: "billing.subscription_synced",
      metadata: { plan: decision.plan, status, event: eventName, keptPlanForUnmappedPrice: decision.keptPlanForUnmappedPrice },
    });
    return { applied: true, plan: decision.plan } as const;
  });

  if (!outcome.applied) {
    console.info(JSON.stringify({ msg: "paddle_subscription_event_ignored", reason: outcome.reason, event: eventName }));
    return outcome;
  }

  if (eventName === "subscription.created") {
    trackEvent("subscription_started", { organizationId });
    // Free scanner funnel: attribute the subscription to the scan that brought this workspace in (no-op otherwise).
    await attributeToScanner(organizationId, status === "trialing" ? "trial_started" : "subscription_started");
  }
  return outcome;
}

export type SyncOutcome = { applied: true; plan: string } | { applied: false; reason: string };

/** Serializes billing writes for one organization. Held until the surrounding transaction ends. */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR UPDATE`;
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
  eventName: string,
  meta: { occurredAt?: Date | null; subscriptionId?: string | null } = {}
): Promise<SyncOutcome> {
  const result = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) return { applied: false, reason: "organization_missing" } as const;

    const decision = decideTransactionOutcome(organization, { outcome, subscriptionId: meta.subscriptionId, occurredAt: meta.occurredAt ?? null });
    if (decision.kind === "skip") return { applied: false, reason: decision.reason } as const;

    if (decision.nextStatus !== organization.subscriptionStatus || decision.paymentEventAt) {
      await tx.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: decision.nextStatus, paymentEventAt: decision.paymentEventAt },
      });
    }

    await recordAuditEvent(tx, {
      organizationId,
      actorType: "SYSTEM",
      eventType: AUDIT_EVENT_TYPES.BILLING_PLAN_CHANGED,
      entityType: "Organization",
      entityId: organizationId,
      action: outcome === "failed" ? "billing.payment_failed" : "billing.payment_succeeded",
      metadata: { event: eventName },
    });
    return { applied: true, plan: organization.plan } as const;
  });

  if (!result.applied) console.info(JSON.stringify({ msg: "paddle_transaction_event_ignored", reason: result.reason, event: eventName }));
  return result;
}
