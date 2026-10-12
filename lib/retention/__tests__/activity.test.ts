import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/billing/plans";
import { DOWNGRADE_GRACE_DAYS, PAUSED_HOLD_DAYS, activityRetentionCutoff, purgeBoundary, retentionEligibility } from "@/lib/retention/activity";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("activityRetentionCutoff", () => {
  it("is exactly N*24h before now, in UTC instants (no timezone / DST dependence)", () => {
    expect(activityRetentionCutoff(7, NOW).toISOString()).toBe("2026-10-04T12:00:00.000Z");
    // 30 days back crosses a DST change in many zones; the instant arithmetic must not care.
    expect(activityRetentionCutoff(30, new Date("2026-11-02T00:00:00Z")).getTime()).toBe(new Date("2026-11-02T00:00:00Z").getTime() - 30 * DAY);
  });

  it("uses each plan's configured window", () => {
    expect(PLANS.free.activityRetentionDays).toBe(7);
    expect(NOW.getTime() - activityRetentionCutoff(PLANS.free.activityRetentionDays, NOW).getTime()).toBe(7 * DAY);
    expect(NOW.getTime() - activityRetentionCutoff(PLANS.startup.activityRetentionDays, NOW).getTime()).toBe(30 * DAY);
    expect(NOW.getTime() - activityRetentionCutoff(PLANS.growth.activityRetentionDays, NOW).getTime()).toBe(90 * DAY);
    expect(NOW.getTime() - activityRetentionCutoff(PLANS.business.activityRetentionDays, NOW).getTime()).toBe(365 * DAY);
  });

  it("paid plans keep strictly more history than Free", () => {
    const days = (id: keyof typeof PLANS) => PLANS[id].activityRetentionDays;
    expect(days("startup")).toBeGreaterThan(days("free"));
    expect(days("growth")).toBeGreaterThan(days("startup"));
    expect(days("business")).toBeGreaterThan(days("growth"));
  });
});

describe("purgeBoundary", () => {
  const cutoff = new Date("2026-10-04T12:00:00Z");

  it("never lets the boundary pass the cutoff", () => {
    const rolled = new Date("2026-10-11T12:00:00Z");
    expect(purgeBoundary(cutoff, { status: "ACTIVE", rollupThrough: rolled })).toEqual(cutoff);
  });

  it("holds back events the baseline has not rolled up yet", () => {
    const behind = new Date("2026-10-01T00:00:00Z");
    expect(purgeBoundary(cutoff, { status: "ACTIVE", rollupThrough: behind })).toEqual(behind);
  });

  it("deletes nothing for a live agent that was never rolled up", () => {
    expect(purgeBoundary(cutoff, { status: "ACTIVE", rollupThrough: null })).toBeNull();
  });

  it("does not hold back archived agents (they are not baselined)", () => {
    expect(purgeBoundary(cutoff, { status: "ARCHIVED", rollupThrough: null })).toEqual(cutoff);
  });
});

describe("retentionEligibility", () => {
  const free = (over: Partial<Parameters<typeof retentionEligibility>[0]> = {}) => ({ plan: "free", subscriptionStatus: null, planDowngradedAt: null, ...over });
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

  it("an organization that has always been Free, and every paid plan, follow their normal window", () => {
    expect(retentionEligibility(free(), NOW)).toEqual({ eligible: true });
    for (const plan of ["startup", "growth", "business", "enterprise"]) {
      expect(retentionEligibility({ plan, subscriptionStatus: "active", planDowngradedAt: null }, NOW)).toEqual({ eligible: true });
    }
  });

  it("never purges an unknown plan string", () => {
    expect(retentionEligibility({ plan: "legacy-plan", subscriptionStatus: null, planDowngradedAt: null }, NOW)).toEqual({ eligible: false, reason: "unknown_plan" });
  });

  it("a billing anomaly (Free plan + active / trialing / past_due subscription) always skips", () => {
    for (const subscriptionStatus of ["active", "trialing", "past_due"]) {
      expect(retentionEligibility(free({ subscriptionStatus }), NOW)).toEqual({ eligible: false, reason: "billing_anomaly" });
    }
  });

  it("an ended subscription on Free is NOT an anomaly (cancelled / paused / expired are legitimately Free)", () => {
    for (const subscriptionStatus of ["cancelled", "expired"]) {
      expect(retentionEligibility(free({ subscriptionStatus }), NOW)).toEqual({ eligible: true });
    }
  });

  describe("paused subscriptions (90-day hold from planDowngradedAt)", () => {
    const paused = (planDowngradedAt: Date | null) => free({ subscriptionStatus: "paused", planDowngradedAt });
    const ago = (ms: number) => new Date(NOW.getTime() - ms);

    it("the cap is 90 days", () => {
      expect(PAUSED_HOLD_DAYS).toBe(90);
    });

    it("holds through the 14-day grace period and until the cap", () => {
      expect(retentionEligibility(paused(ago(1 * DAY)), NOW)).toEqual({ eligible: false, reason: "paused_hold" });
      expect(retentionEligibility(paused(ago(30 * DAY)), NOW)).toEqual({ eligible: false, reason: "paused_hold" });
      expect(retentionEligibility(paused(ago(90 * DAY - 1)), NOW)).toEqual({ eligible: false, reason: "paused_hold" });
    });

    it("at exactly 90 days and beyond, normal Free retention applies", () => {
      expect(retentionEligibility(paused(ago(90 * DAY)), NOW)).toEqual({ eligible: true });
      expect(retentionEligibility(paused(ago(200 * DAY)), NOW)).toEqual({ eligible: true });
    });

    it("an unknown pause start (NULL timestamp) deletes nothing and is reported distinctly", () => {
      expect(retentionEligibility(paused(null), NOW)).toEqual({ eligible: false, reason: "paused_no_anchor" });
    });

    it("does not affect other states: cancelled/expired with an old pause timestamp use the 14-day grace, not the hold", () => {
      expect(retentionEligibility(free({ subscriptionStatus: "cancelled", planDowngradedAt: ago(30 * DAY) }), NOW)).toEqual({ eligible: true });
      expect(retentionEligibility(free({ subscriptionStatus: "cancelled", planDowngradedAt: ago(1 * DAY) }), NOW)).toEqual({ eligible: false, reason: "downgrade_grace" });
    });

    it("a billing anomaly and an unknown plan still win over the hold", () => {
      expect(retentionEligibility({ plan: "legacy-plan", subscriptionStatus: "paused", planDowngradedAt: ago(1 * DAY) }, NOW)).toEqual({ eligible: false, reason: "unknown_plan" });
    });
  });

  it("the grace period protects a recent downgrade for exactly 14 days, then normal retention resumes", () => {
    expect(DOWNGRADE_GRACE_DAYS).toBe(14);
    expect(retentionEligibility(free({ planDowngradedAt: daysAgo(1) }), NOW)).toEqual({ eligible: false, reason: "downgrade_grace" });
    expect(retentionEligibility(free({ planDowngradedAt: new Date(NOW.getTime() - 14 * DAY + 1) }), NOW)).toEqual({ eligible: false, reason: "downgrade_grace" });
    expect(retentionEligibility(free({ planDowngradedAt: new Date(NOW.getTime() - 14 * DAY) }), NOW)).toEqual({ eligible: true });
    expect(retentionEligibility(free({ planDowngradedAt: daysAgo(40) }), NOW)).toEqual({ eligible: true });
  });

  it("the grace period can never override a billing anomaly", () => {
    expect(retentionEligibility(free({ subscriptionStatus: "active", planDowngradedAt: daysAgo(100) }), NOW)).toEqual({ eligible: false, reason: "billing_anomaly" });
    expect(retentionEligibility(free({ subscriptionStatus: "past_due", planDowngradedAt: daysAgo(1) }), NOW)).toEqual({ eligible: false, reason: "billing_anomaly" });
  });

  it("a stale downgrade timestamp on a paid plan is ignored (it is only meaningful while Free)", () => {
    expect(retentionEligibility({ plan: "startup", subscriptionStatus: "active", planDowngradedAt: daysAgo(1) }, NOW)).toEqual({ eligible: true });
  });
});
