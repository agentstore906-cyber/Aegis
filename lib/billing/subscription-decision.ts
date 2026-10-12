import "server-only";

import { DEFAULT_PLAN_ID, isPlanId, type PlanId } from "@/lib/billing/plans";
import { resolvePlanForPriceId, statusGrantsPaidPlan, type BillingStatus } from "@/lib/billing/paddle";

/**
 * Pure rules for applying a Paddle event to an organization's billing state. No database, no clock (callers pass
 * `now`), so every rule is unit-testable. `lib/billing/sync.ts` runs these inside a per-organization row lock.
 *
 * What these rules guarantee:
 *  - A subscription that is PAID (active / trialing / past_due) is never turned into Free because Aegis cannot
 *    identify its price. It keeps its current plan when that is provably the same price, otherwise the event FAILS
 *    (`UnmappedPriceError` -> HTTP 500, not recorded, Paddle retries) so a human fixes the configuration and the
 *    retry heals it.
 *  - An event older than the newest applied one never overwrites newer state.
 *  - An event about a subscription the organization has replaced (while its current one is still live) is ignored.
 *  - The downgrade timestamp is set once, on the paid -> free transition, and restamped when a PAUSED subscription ends
 *    (paused, or paused then past_due, -> cancelled/expired), so an old pause time cannot make the cancellation
 *    grace period already expired.
 */

export class UnmappedPriceError extends Error {
  constructor(
    readonly subscriptionId: string,
    readonly priceIdPrefix: string | null
  ) {
    super("A paid Paddle subscription uses a price id that matches no configured plan; refusing to change the plan.");
    this.name = "UnmappedPriceError";
  }
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
/** The organization's current subscription still grants paid access (so an event about another one is suspect). */
export const isLiveSubscriptionStatus = (status: string | null | undefined): boolean => LIVE_STATUSES.has(status ?? "");

export type OrgBillingState = {
  plan: string;
  paddleSubscriptionId: string | null;
  paddlePriceId: string | null;
  subscriptionStatus: string | null;
  billingEventAt: Date | null;
  paymentEventAt: Date | null;
  planDowngradedAt: Date | null;
};

export type SubscriptionEvent = {
  eventName: string;
  subscriptionId: string;
  status: BillingStatus;
  priceId: string | null | undefined;
  /** Paddle's `occurred_at`; null if absent/unparseable (then no ordering check and the watermark is not advanced). */
  occurredAt: Date | null;
};

export type SubscriptionDecision =
  | { kind: "skip"; reason: "stale" | "replaced_subscription" }
  | {
      kind: "apply";
      plan: PlanId;
      /** `undefined` = leave the stored value alone; a Date = set; `null` = clear. */
      planDowngradedAt: Date | null | undefined;
      billingEventAt: Date | undefined;
      /** True when the price was unmapped but the organization's own stored state proved it is the same paid price. */
      keptPlanForUnmappedPrice: boolean;
    };

const isPaidPlan = (plan: string): boolean => isPlanId(plan) && plan !== DEFAULT_PLAN_ID;

export function decideSubscriptionSync(org: OrgBillingState, event: SubscriptionEvent, now: Date): SubscriptionDecision {
  // 1. Stale: Paddle does not guarantee delivery order. Equal timestamps apply (replays stay idempotent).
  if (event.occurredAt && org.billingEventAt && event.occurredAt < org.billingEventAt) {
    return { kind: "skip", reason: "stale" };
  }

  // 2. Replaced subscription: the organization has a different, still-live subscription, and this isn't the event
  //    announcing a new one. (If the current one is already dead, the event is adopted.)
  if (
    event.eventName !== "subscription.created" &&
    org.paddleSubscriptionId &&
    org.paddleSubscriptionId !== event.subscriptionId &&
    isLiveSubscriptionStatus(org.subscriptionStatus)
  ) {
    return { kind: "skip", reason: "replaced_subscription" };
  }

  // 3. Which plan. A status that no longer grants paid access is Free whatever the price; a paid one must be identified.
  let plan: PlanId = DEFAULT_PLAN_ID;
  let keptPlanForUnmappedPrice = false;
  if (statusGrantsPaidPlan(event.status)) {
    const mapped = resolvePlanForPriceId(event.priceId);
    if (mapped) {
      plan = mapped;
    } else {
      const samePriceAsStored = Boolean(event.priceId?.trim()) && org.paddlePriceId?.trim() === event.priceId?.trim();
      if (samePriceAsStored && isPaidPlan(org.plan)) {
        plan = org.plan as PlanId;
        keptPlanForUnmappedPrice = true;
      } else {
        throw new UnmappedPriceError(event.subscriptionId, event.priceId?.trim().slice(0, 4) || null);
      }
    }
  }

  // 4. Grace-period anchor: stamp only on the paid -> free TRANSITION (and when a paused subscription ends); clear when a
  //    paid plan is (re)granted;
  //    otherwise leave it exactly as it is (a repeated or retried free event must never restart the grace period).
  let planDowngradedAt: Date | null | undefined;
  if (plan === DEFAULT_PLAN_ID) {
    // A subscription that ENDS while the organization is already downgraded (paused, or paused and then flipped to
    // past_due by a failed payment) starts its own grace period now. Keyed on "was not already ended" rather than on
    // "was paused", so a payment event cannot hide the pause; an already-ended status (replayed cancel) never restamps.
    // "Already downgraded" is read from what the row can prove: status `paused`, an existing stamp, or `past_due` on a
    // Free plan WITH a recorded subscription (a Free plan can only be past_due after a subscription was downgraded or
    // flipped by a payment event). That last clause also covers a legacy paused row with no stamp. An organization that
    // never had a subscription (no subscription id) is never given an artificial stamp. Limitation: a Free `past_due`
    // organization with a subscription is stamped when it ends even if it was never paused - 14 days of extra retention.
    const endsNow = event.status === "cancelled" || event.status === "expired";
    const wasEnded = org.subscriptionStatus === "cancelled" || org.subscriptionStatus === "expired";
    const alreadyDowngraded =
      org.subscriptionStatus === "paused" ||
      org.planDowngradedAt !== null ||
      (org.subscriptionStatus === "past_due" && org.paddleSubscriptionId !== null);
    const endsDowngraded = endsNow && !wasEnded && alreadyDowngraded;
    planDowngradedAt = isPaidPlan(org.plan) || endsDowngraded ? now : undefined;
  } else planDowngradedAt = org.planDowngradedAt ? null : undefined;

  return { kind: "apply", plan, planDowngradedAt, billingEventAt: event.occurredAt ?? undefined, keptPlanForUnmappedPrice };
}

export type TransactionEvent = {
  outcome: "succeeded" | "failed";
  subscriptionId: string | null | undefined;
  occurredAt: Date | null;
};

export type TransactionDecision =
  | { kind: "skip"; reason: "superseded_by_subscription_event" | "stale" | "replaced_subscription" }
  | { kind: "apply"; nextStatus: string | null; paymentEventAt: Date | undefined };

export function decideTransactionOutcome(org: OrgBillingState, event: TransactionEvent): TransactionDecision {
  if (event.occurredAt) {
    // A newer subscription event already set the status absolutely; this one describes an older moment.
    if (org.billingEventAt && event.occurredAt < org.billingEventAt) return { kind: "skip", reason: "superseded_by_subscription_event" };
    // An older payment result must not override a newer one (failed after completed, or the reverse).
    if (org.paymentEventAt && event.occurredAt < org.paymentEventAt) return { kind: "skip", reason: "stale" };
  }
  if (event.subscriptionId && org.paddleSubscriptionId && org.paddleSubscriptionId !== event.subscriptionId && isLiveSubscriptionStatus(org.subscriptionStatus)) {
    return { kind: "skip", reason: "replaced_subscription" };
  }
  const nextStatus = event.outcome === "failed" ? "past_due" : org.subscriptionStatus === "past_due" ? "active" : org.subscriptionStatus;
  return { kind: "apply", nextStatus, paymentEventAt: event.occurredAt ?? undefined };
}
