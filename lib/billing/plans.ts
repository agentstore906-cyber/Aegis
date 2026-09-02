import "server-only";

/**
 * The single source of truth for what each plan actually includes.
 * `lib/pricing.ts` (the marketing pricing page's copy) derives its
 * feature-bullet strings from these same numbers so the two can never
 * drift — see `lib/pricing.ts`. `lib/billing/entitlements.ts` enforces
 * these limits server-side; nothing here is UI-only.
 */
export type PlanId = "free" | "startup" | "growth" | "business" | "enterprise";

export interface PlanConfig {
  id: PlanId;
  name: string;
  /** Cents/month. `null` = custom pricing (Enterprise — "Contact us"). */
  priceCents: number | null;
  /** `null` = unlimited. */
  agentLimit: number | null;
  /** `null` = unlimited. */
  memberLimit: number | null;
  /** `null` = unlimited. */
  apiKeyLimit: number | null;
  activityRetentionDays: number;
  advancedPolicies: boolean;
  auditExport: boolean;
  webhooks: boolean;
  /**
   * Lemon Squeezy variant id, resolved from env at import time so a plan
   * with no configured variant simply can't be checked out (the checkout
   * action fails with a clear "not available for self-serve" error rather
   * than sending an empty id to Lemon Squeezy) — see lib/billing/actions.ts.
   */
  lemonSqueezyVariantId: string | null;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    agentLimit: 3,
    memberLimit: 3,
    apiKeyLimit: 2,
    activityRetentionDays: 7,
    advancedPolicies: false,
    auditExport: false,
    webhooks: false,
    lemonSqueezyVariantId: null,
  },
  startup: {
    id: "startup",
    name: "Startup",
    priceCents: 9900,
    agentLimit: 25,
    memberLimit: 5,
    apiKeyLimit: 5,
    activityRetentionDays: 30,
    advancedPolicies: true,
    auditExport: false,
    webhooks: true,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_STARTUP_VARIANT_ID ?? null,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceCents: 29900,
    agentLimit: 100,
    memberLimit: 20,
    apiKeyLimit: 20,
    activityRetentionDays: 90,
    advancedPolicies: true,
    auditExport: true,
    webhooks: true,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_GROWTH_VARIANT_ID ?? null,
  },
  business: {
    id: "business",
    name: "Business",
    priceCents: 99900,
    agentLimit: 500,
    memberLimit: 100,
    apiKeyLimit: 100,
    activityRetentionDays: 365,
    advancedPolicies: true,
    auditExport: true,
    webhooks: true,
    lemonSqueezyVariantId: process.env.LEMONSQUEEZY_BUSINESS_VARIANT_ID ?? null,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceCents: null,
    agentLimit: null,
    memberLimit: null,
    apiKeyLimit: null,
    activityRetentionDays: 365,
    advancedPolicies: true,
    auditExport: true,
    webhooks: true,
    lemonSqueezyVariantId: null,
  },
};

export const DEFAULT_PLAN_ID: PlanId = "free";

const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Always returns a valid plan — an unrecognized/legacy `Organization.plan` string falls back to Free rather than throwing. */
export function getPlan(planId: string | null | undefined): PlanConfig {
  const id = PLAN_IDS.includes(planId as PlanId) ? (planId as PlanId) : DEFAULT_PLAN_ID;
  return PLANS[id];
}
