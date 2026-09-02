import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";
import { DEFAULT_PLAN_ID } from "@/lib/billing/plans";
import {
  mapSubscriptionStatus,
  planIdForVariant,
  statusGrantsPaidPlan,
} from "@/lib/billing/lemonsqueezy";

/** The subset of a Lemon Squeezy subscription's `attributes` this code reads. */
export interface LemonSqueezySubscriptionAttributes {
  status?: string;
  customer_id?: number | string;
  variant_id?: number | string;
  cancelled?: boolean;
  renews_at?: string | null;
  ends_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Writes a Lemon Squeezy subscription's current state onto the
 * organization. Idempotent by construction: it sets *absolute* values from
 * the payload (never deltas), so replaying an event, or events arriving out
 * of order, converge to whatever Lemon Squeezy last reported. `plan` — the
 * column Aegis actually enforces entitlements against — drops to free the
 * moment the status stops granting a paid plan (expired/unpaid/paused).
 */
export async function syncSubscriptionState(
  organizationId: string,
  subscriptionId: string,
  attributes: LemonSqueezySubscriptionAttributes,
  eventName: string
): Promise<void> {
  const status = mapSubscriptionStatus(attributes.status);
  const planId = statusGrantsPaidPlan(status) ? planIdForVariant(attributes.variant_id) : DEFAULT_PLAN_ID;

  const periodEndRaw = attributes.ends_at ?? attributes.renews_at ?? null;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: planId,
      lemonSqueezyCustomerId: attributes.customer_id != null ? String(attributes.customer_id) : undefined,
      lemonSqueezySubscriptionId: subscriptionId,
      lemonSqueezyVariantId: attributes.variant_id != null ? String(attributes.variant_id) : undefined,
      subscriptionStatus: status,
      billingInterval: "month",
      currentPeriodStart:
        eventName === "subscription_created" && attributes.created_at
          ? new Date(attributes.created_at)
          : undefined,
      currentPeriodEnd: periodEndRaw ? new Date(periodEndRaw) : null,
      cancelAtPeriodEnd: attributes.cancelled === true,
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

  if (eventName === "subscription_created") {
    trackEvent("subscription_started", { organizationId });
  }
}
