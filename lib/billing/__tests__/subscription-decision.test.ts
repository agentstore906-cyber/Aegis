import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PLANS } from "@/lib/billing/plans";
import { planIdForPriceId, resolvePlanForPriceId } from "@/lib/billing/paddle";
import {
  UnmappedPriceError,
  decideSubscriptionSync,
  decideTransactionOutcome,
  type OrgBillingState,
  type SubscriptionEvent,
} from "@/lib/billing/subscription-decision";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

const original = { startup: PLANS.startup.paddlePriceId, growth: PLANS.growth.paddlePriceId };
beforeEach(() => {
  (PLANS.startup as { paddlePriceId: string | null }).paddlePriceId = "pri_startup_x";
  (PLANS.growth as { paddlePriceId: string | null }).paddlePriceId = "pri_growth_x";
});
afterEach(() => {
  (PLANS.startup as { paddlePriceId: string | null }).paddlePriceId = original.startup;
  (PLANS.growth as { paddlePriceId: string | null }).paddlePriceId = original.growth;
});

const org = (over: Partial<OrgBillingState> = {}): OrgBillingState => ({
  plan: "growth",
  paddleSubscriptionId: "sub_1",
  paddlePriceId: "pri_growth_x",
  subscriptionStatus: "active",
  billingEventAt: null,
  paymentEventAt: null,
  planDowngradedAt: null,
  ...over,
});
const sub = (over: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  eventName: "subscription.updated",
  subscriptionId: "sub_1",
  status: "active",
  priceId: "pri_growth_x",
  occurredAt: at("2026-10-11T10:00:00Z"),
  ...over,
});

describe("price resolution", () => {
  it("matches ignoring whitespace on either side (checkout trims the same id)", () => {
    expect(resolvePlanForPriceId("  pri_growth_x\n")).toBe("growth");
    (PLANS.growth as { paddlePriceId: string | null }).paddlePriceId = "pri_growth_x \n";
    expect(resolvePlanForPriceId("pri_growth_x")).toBe("growth");
  });

  it("returns null — never 'free' — for unknown, empty or missing ids", () => {
    for (const bad of ["pri_other", "", "   ", null, undefined]) expect(resolvePlanForPriceId(bad)).toBeNull();
  });

  it("the display helper keeps its contract (unknown -> free) and is not used for decisions", () => {
    expect(planIdForPriceId("pri_other")).toBe("free");
  });
});

describe("unmapped price on a PAID subscription never silently downgrades", () => {
  it("throws UnmappedPriceError (so the webhook fails, retries, and nothing is written) for a new/unknown price", () => {
    expect(() => decideSubscriptionSync(org(), sub({ priceId: "pri_repriced" }), NOW)).toThrow(UnmappedPriceError);
    expect(() => decideSubscriptionSync(org({ plan: "free", paddlePriceId: null, paddleSubscriptionId: null, subscriptionStatus: null }), sub({ priceId: "pri_repriced" }), NOW)).toThrow(UnmappedPriceError);
    expect(() => decideSubscriptionSync(org(), sub({ priceId: null }), NOW)).toThrow(UnmappedPriceError);
  });

  it("the error carries only a 4-character price prefix, never the full id", () => {
    try {
      decideSubscriptionSync(org(), sub({ priceId: "pri_secretvalue123" }), NOW);
      expect.unreachable();
    } catch (e) {
      expect((e as UnmappedPriceError).priceIdPrefix).toBe("pri_");
      expect(JSON.stringify(e)).not.toContain("secretvalue123");
    }
  });

  it("keeps the current paid plan when the org's own stored price proves it is the same price (repriced legacy subscriber)", () => {
    const decision = decideSubscriptionSync(org({ paddlePriceId: "pri_legacy" }), sub({ priceId: "pri_legacy" }), NOW);
    expect(decision).toMatchObject({ kind: "apply", plan: "growth", keptPlanForUnmappedPrice: true, planDowngradedAt: undefined });
  });

  it("does NOT trust a stored price when the org is on Free (that would mask the very bug being prevented)", () => {
    expect(() => decideSubscriptionSync(org({ plan: "free", paddlePriceId: "pri_legacy" }), sub({ priceId: "pri_legacy" }), NOW)).toThrow(UnmappedPriceError);
  });

  it("still downgrades when the subscription genuinely ended — the price is irrelevant then", () => {
    for (const status of ["cancelled", "paused", "expired"] as const) {
      const decision = decideSubscriptionSync(org(), sub({ status, priceId: "pri_repriced" }), NOW);
      expect(decision).toMatchObject({ kind: "apply", plan: "free" });
    }
  });

  it("maps a configured price to its plan, including a change between paid plans", () => {
    expect(decideSubscriptionSync(org({ plan: "startup" }), sub({ priceId: "pri_growth_x" }), NOW)).toMatchObject({ plan: "growth" });
    expect(decideSubscriptionSync(org(), sub({ priceId: "pri_startup_x" }), NOW)).toMatchObject({ plan: "startup" });
  });
});

describe("ordering", () => {
  it("ignores an event older than the newest applied one", () => {
    const decision = decideSubscriptionSync(org({ billingEventAt: at("2026-10-11T11:00:00Z") }), sub({ occurredAt: at("2026-10-11T10:00:00Z"), status: "cancelled" }), NOW);
    expect(decision).toEqual({ kind: "skip", reason: "stale" });
  });

  it("applies an event with an equal timestamp (idempotent replay) and a newer one, and advances the watermark", () => {
    const equal = decideSubscriptionSync(org({ billingEventAt: at("2026-10-11T10:00:00Z") }), sub(), NOW);
    expect(equal).toMatchObject({ kind: "apply", billingEventAt: at("2026-10-11T10:00:00Z") });
    const newer = decideSubscriptionSync(org({ billingEventAt: at("2026-10-11T09:00:00Z") }), sub(), NOW);
    expect(newer).toMatchObject({ kind: "apply", billingEventAt: at("2026-10-11T10:00:00Z") });
  });

  it("a first event (no watermark) applies, and an event without a usable time applies without moving the watermark", () => {
    expect(decideSubscriptionSync(org(), sub(), NOW)).toMatchObject({ kind: "apply" });
    expect(decideSubscriptionSync(org({ billingEventAt: at("2026-10-11T11:00:00Z") }), sub({ occurredAt: null }), NOW)).toMatchObject({ kind: "apply", billingEventAt: undefined });
  });
});

describe("replaced subscriptions", () => {
  it("ignores update/cancel events for a subscription the org no longer uses while its current one is live", () => {
    for (const eventName of ["subscription.updated", "subscription.canceled"]) {
      const decision = decideSubscriptionSync(org(), sub({ eventName, subscriptionId: "sub_OLD", status: "cancelled" }), NOW);
      expect(decision).toEqual({ kind: "skip", reason: "replaced_subscription" });
    }
  });

  it("a subscription.created for another subscription IS applied (that is the replacement arriving)", () => {
    expect(decideSubscriptionSync(org(), sub({ eventName: "subscription.created", subscriptionId: "sub_NEW" }), NOW)).toMatchObject({ kind: "apply", plan: "growth" });
  });

  it("adopts an update for a different subscription when the current one is already dead", () => {
    const dead = org({ plan: "free", subscriptionStatus: "cancelled" });
    expect(decideSubscriptionSync(dead, sub({ subscriptionId: "sub_NEW" }), NOW)).toMatchObject({ kind: "apply", plan: "growth" });
  });
});

describe("downgrade timestamp (grace-period anchor)", () => {
  it("is set once, on the paid -> free transition, to the time Aegis applied it", () => {
    const decision = decideSubscriptionSync(org(), sub({ status: "cancelled", eventName: "subscription.canceled" }), NOW);
    expect(decision).toMatchObject({ kind: "apply", plan: "free", planDowngradedAt: NOW });
  });

  it("is NOT refreshed by repeated or retried free events", () => {
    const already = org({ plan: "free", planDowngradedAt: at("2026-10-01T00:00:00Z"), subscriptionStatus: "cancelled" });
    const decision = decideSubscriptionSync(already, sub({ status: "cancelled", eventName: "subscription.canceled", occurredAt: at("2026-10-11T10:00:00Z") }), NOW);
    expect(decision).toMatchObject({ kind: "apply", plan: "free", planDowngradedAt: undefined });
  });

  it("is not set for an organization that was already Free (or had an unknown plan string)", () => {
    expect(decideSubscriptionSync(org({ plan: "free" }), sub({ status: "expired" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
    expect(decideSubscriptionSync(org({ plan: "legacy-plan" }), sub({ status: "expired" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
  });

  it("is cleared when a paid plan returns (re-subscription), and left alone if it was never set", () => {
    const resub = decideSubscriptionSync(org({ plan: "free", planDowngradedAt: at("2026-10-01T00:00:00Z"), subscriptionStatus: "cancelled" }), sub({ eventName: "subscription.created", subscriptionId: "sub_2" }), NOW);
    expect(resub).toMatchObject({ plan: "growth", planDowngradedAt: null });
    expect(decideSubscriptionSync(org(), sub(), NOW)).toMatchObject({ planDowngradedAt: undefined });
  });
});

describe("paused subscriptions and the downgrade anchor", () => {
  const pausedOrg = (over: Partial<OrgBillingState> = {}) =>
    org({ plan: "free", subscriptionStatus: "paused", planDowngradedAt: at("2026-08-01T00:00:00Z"), ...over });

  it("pausing a paid plan stamps the anchor at the time Aegis applied it", () => {
    expect(decideSubscriptionSync(org(), sub({ status: "paused", eventName: "subscription.paused" }), NOW)).toMatchObject({ plan: "free", planDowngradedAt: NOW });
  });

  it("a repeated paused event leaves the original pause time alone", () => {
    expect(decideSubscriptionSync(pausedOrg(), sub({ status: "paused", eventName: "subscription.paused" }), NOW)).toMatchObject({ plan: "free", planDowngradedAt: undefined });
  });

  it("resuming restores the plan and clears the anchor (the plan's own retention applies again)", () => {
    expect(decideSubscriptionSync(pausedOrg(), sub({ status: "active", eventName: "subscription.resumed" }), NOW)).toMatchObject({ plan: "growth", planDowngradedAt: null });
  });

  it("paused -> cancelled or expired restamps the anchor, so an old pause time cannot bypass the cancellation grace", () => {
    for (const status of ["cancelled", "expired"] as const) {
      expect(decideSubscriptionSync(pausedOrg(), sub({ status, eventName: "subscription.canceled" }), NOW)).toMatchObject({ plan: "free", planDowngradedAt: NOW });
    }
  });

  it("restamps a legacy paused organization that has no anchor, too", () => {
    expect(decideSubscriptionSync(pausedOrg({ planDowngradedAt: null }), sub({ status: "cancelled", eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: NOW });
  });

  it("a replayed cancel after the restamp does not restart the grace period (status is no longer paused)", () => {
    const afterCancel = org({ plan: "free", subscriptionStatus: "cancelled", planDowngradedAt: NOW });
    expect(decideSubscriptionSync(afterCancel, sub({ status: "cancelled", eventName: "subscription.canceled", occurredAt: at("2026-10-11T11:00:00Z") }), at("2026-10-12T12:00:00Z"))).toMatchObject({ planDowngradedAt: undefined });
  });

  it("cancelling a non-paused free organization is unchanged (no anchor invented)", () => {
    expect(decideSubscriptionSync(org({ plan: "free", subscriptionStatus: "cancelled" }), sub({ status: "cancelled", eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
  });
});

describe("transaction events", () => {
  const txn = (over: Partial<Parameters<typeof decideTransactionOutcome>[1]> = {}) => ({ outcome: "failed" as const, subscriptionId: "sub_1", occurredAt: at("2026-10-11T10:00:00Z"), ...over });

  it("a failed payment marks past_due and a completed payment recovers it", () => {
    expect(decideTransactionOutcome(org(), txn())).toMatchObject({ kind: "apply", nextStatus: "past_due" });
    expect(decideTransactionOutcome(org({ subscriptionStatus: "past_due" }), txn({ outcome: "succeeded" }))).toMatchObject({ nextStatus: "active" });
  });

  it("an older payment result never overrides a newer one", () => {
    const newerCompleted = org({ paymentEventAt: at("2026-10-11T11:00:00Z") });
    expect(decideTransactionOutcome(newerCompleted, txn({ occurredAt: at("2026-10-11T10:00:00Z") }))).toEqual({ kind: "skip", reason: "stale" });
  });

  it("a payment event older than the newest subscription event is superseded (that event set the status absolutely)", () => {
    const decision = decideTransactionOutcome(org({ billingEventAt: at("2026-10-11T11:00:00Z") }), txn());
    expect(decision).toEqual({ kind: "skip", reason: "superseded_by_subscription_event" });
  });

  it("ignores payments of a replaced subscription, but the very first checkout payment (no subscription yet) applies", () => {
    expect(decideTransactionOutcome(org(), txn({ subscriptionId: "sub_OLD" }))).toEqual({ kind: "skip", reason: "replaced_subscription" });
    expect(decideTransactionOutcome(org({ paddleSubscriptionId: null, subscriptionStatus: null }), txn({ outcome: "succeeded", subscriptionId: "sub_1" }))).toMatchObject({ kind: "apply" });
  });

  it("advances the payment watermark only when the event has a usable time", () => {
    expect(decideTransactionOutcome(org(), txn())).toMatchObject({ paymentEventAt: at("2026-10-11T10:00:00Z") });
    expect(decideTransactionOutcome(org(), txn({ occurredAt: null }))).toMatchObject({ paymentEventAt: undefined });
  });
});

describe("pause -> failed payment -> end keeps the cancellation grace (M1)", () => {
  // A failed payment while paused flips the stored status to past_due; the pause anchor is still on the row.
  const pausedThenPastDue = (over: Partial<OrgBillingState> = {}) =>
    org({ plan: "free", subscriptionStatus: "past_due", planDowngradedAt: at("2026-08-01T00:00:00Z"), ...over });

  it.each(["cancelled", "expired"] as const)("restamps the anchor when the subscription ends from past_due (%s)", (status) => {
    expect(decideSubscriptionSync(pausedThenPastDue(), sub({ status, eventName: "subscription.canceled" }), NOW)).toMatchObject({ kind: "apply", plan: "free", planDowngradedAt: NOW });
  });

  it.each(["cancelled", "expired"] as const)("a replayed %s event does not restamp an already-ended subscription", (status) => {
    const ended = org({ plan: "free", subscriptionStatus: status, planDowngradedAt: NOW });
    const later = at("2026-10-13T12:00:00Z");
    expect(decideSubscriptionSync(ended, sub({ status, eventName: "subscription.canceled", occurredAt: at("2026-10-12T00:00:00Z") }), later)).toMatchObject({ planDowngradedAt: undefined });
  });

  it("does not invent an anchor for an organization that never had a subscription", () => {
    for (const status of ["cancelled", "expired"] as const) {
      const never = org({ plan: "free", subscriptionStatus: null, paddleSubscriptionId: null, planDowngradedAt: null });
      expect(decideSubscriptionSync(never, sub({ status, eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
      const neverPastDue = org({ plan: "free", subscriptionStatus: "past_due", paddleSubscriptionId: null, planDowngradedAt: null });
      expect(decideSubscriptionSync(neverPastDue, sub({ status, eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
    }
  });

  it("the earlier transitions are unchanged: paused -> cancelled/expired restamps, paused -> resumed clears", () => {
    const paused = org({ plan: "free", subscriptionStatus: "paused", planDowngradedAt: at("2026-08-01T00:00:00Z") });
    expect(decideSubscriptionSync(paused, sub({ status: "cancelled", eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: NOW });
    expect(decideSubscriptionSync(paused, sub({ status: "expired" }), NOW)).toMatchObject({ planDowngradedAt: NOW });
    expect(decideSubscriptionSync(paused, sub({ status: "active", eventName: "subscription.resumed" }), NOW)).toMatchObject({ plan: "growth", planDowngradedAt: null });
  });

  it("ordering: a stale end event is skipped, so it can neither restamp nor shorten protection", () => {
    const state = pausedThenPastDue({ billingEventAt: at("2026-10-11T10:00:00Z") });
    expect(decideSubscriptionSync(state, sub({ status: "cancelled", eventName: "subscription.canceled", occurredAt: at("2026-10-11T09:00:00Z") }), NOW)).toEqual({ kind: "skip", reason: "stale" });
  });

  it("a payment-failed event after the pause moves only the payment status (the setup for the scenario above)", () => {
    const paused = org({ plan: "free", subscriptionStatus: "paused", billingEventAt: at("2026-10-11T09:00:00Z") });
    expect(decideTransactionOutcome(paused, { outcome: "failed", subscriptionId: "sub_1", occurredAt: at("2026-10-11T10:00:00Z") })).toMatchObject({ kind: "apply", nextStatus: "past_due" });
  });
});

describe("legacy paused organization (no stamp) -> failed payment -> end (F1)", () => {
  // Paused before the stamp column existed (planDowngradedAt NULL), then a failed payment flipped it to past_due.
  const legacy = (over: Partial<OrgBillingState> = {}) =>
    org({ plan: "free", subscriptionStatus: "past_due", paddleSubscriptionId: "sub_1", planDowngradedAt: null, ...over });

  it.each(["cancelled", "expired"] as const)("gets a stamp when the subscription ends (%s)", (status) => {
    expect(decideSubscriptionSync(legacy(), sub({ status, eventName: "subscription.canceled" }), NOW)).toMatchObject({ kind: "apply", plan: "free", planDowngradedAt: NOW });
  });

  it("a legacy PAUSED row (no stamp, status still paused) is stamped on the way out, as before", () => {
    expect(decideSubscriptionSync(legacy({ subscriptionStatus: "paused" }), sub({ status: "cancelled", eventName: "subscription.canceled" }), NOW)).toMatchObject({ planDowngradedAt: NOW });
  });

  it("resume restores the plan; the stored stamp state is cleared only if there was one", () => {
    expect(decideSubscriptionSync(legacy(), sub({ status: "active", eventName: "subscription.resumed" }), NOW)).toMatchObject({ plan: "growth", planDowngradedAt: undefined });
    expect(decideSubscriptionSync(legacy({ planDowngradedAt: at("2026-08-01T00:00:00Z") }), sub({ status: "active", eventName: "subscription.resumed" }), NOW)).toMatchObject({ plan: "growth", planDowngradedAt: null });
  });

  it("a replayed end event on the already-ended row does not restamp", () => {
    const ended = legacy({ subscriptionStatus: "cancelled", planDowngradedAt: NOW });
    expect(decideSubscriptionSync(ended, sub({ status: "cancelled", eventName: "subscription.canceled", occurredAt: at("2026-10-12T00:00:00Z") }), at("2026-10-13T00:00:00Z"))).toMatchObject({ planDowngradedAt: undefined });
  });

  it("a stale end event is skipped before any stamping", () => {
    const state = legacy({ billingEventAt: at("2026-10-11T10:00:00Z") });
    expect(decideSubscriptionSync(state, sub({ status: "cancelled", eventName: "subscription.canceled", occurredAt: at("2026-10-11T09:00:00Z") }), NOW)).toEqual({ kind: "skip", reason: "stale" });
  });

  it("a Free organization on an ACTIVE subscription (not past_due, no stamp) is still not stamped when it ends", () => {
    expect(decideSubscriptionSync(org({ plan: "free", subscriptionStatus: "active", planDowngradedAt: null }), sub({ status: "expired" }), NOW)).toMatchObject({ planDowngradedAt: undefined });
  });
});
