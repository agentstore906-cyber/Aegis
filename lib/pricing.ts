import { PLANS } from "@/lib/billing/plans";
import { formatCurrency } from "@/lib/utils";

export type PricingPlan = {
  id: string;
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  featured?: boolean;
  cta: string;
  features: string[];
};

/**
 * Every claim on a card is either derived from `lib/billing/plans.ts` — the same config `lib/billing/entitlements.ts`
 * actually enforces: numeric limits, and the boolean entitlements (`advancedPolicies`, `webhooks`, `auditExport`) via
 * `granted()` — or is a capability that is available on EVERY plan (so it is listed on Free and never repeated as an
 * upsell), or is an Enterprise service commitment with no code behind it ("Dedicated support", "Custom contracts").
 *
 * Deliberately NOT claimed, because nothing in the backend differs by plan: "full" vs "basic" activity monitoring,
 * cost tracking / cost analytics tiers, security monitoring tiers, team permissions / RBAC tiers (all six roles exist on
 * every plan), SSO (only schema columns exist), "advanced security". Do not reintroduce a claim without a plan check
 * that enforces it; lib/billing/__tests__/pricing-claims.test.ts fails on the known unsupported phrases.
 */
const agents = (id: keyof typeof PLANS) => (PLANS[id].agentLimit === null ? "Unlimited agents" : `${PLANS[id].agentLimit} agents`);
const members = (id: keyof typeof PLANS) => (PLANS[id].memberLimit === null ? "Unlimited members" : `${PLANS[id].memberLimit} members`);
const retention = (id: keyof typeof PLANS) => `${PLANS[id].activityRetentionDays}-day activity history`;
const price = (id: keyof typeof PLANS) => (PLANS[id].priceCents === null ? "Custom" : formatCurrency(PLANS[id].priceCents!));
/** A boolean-entitlement bullet that exists only while the plan really has the entitlement. */
const granted = (has: boolean, label: string): string[] => (has ? [label] : []);

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: PLANS.free.name,
    price: price("free"),
    description: "Try Aegis on a small set of agents.",
    cta: "Get started",
    features: [
      agents("free"),
      members("free"),
      "Free Risk Scanner",
      "Activity monitoring",
      "Policies, approvals and security alerts",
      "Cost tracking",
      retention("free"),
    ],
  },
  {
    id: "startup",
    name: PLANS.startup.name,
    price: price("startup"),
    priceSuffix: "/month",
    description: "For teams putting their first agents into production.",
    cta: "Get started",
    features: [
      "Everything in Free",
      agents("startup"),
      members("startup"),
      retention("startup"),
      ...granted(PLANS.startup.advancedPolicies, "Policy conditions (advanced policies)"),
      ...granted(PLANS.startup.webhooks, "Outbound webhooks"),
    ],
  },
  {
    id: "growth",
    name: PLANS.growth.name,
    price: price("growth"),
    priceSuffix: "/month",
    description: "For companies scaling their AI agent workforce.",
    featured: true,
    cta: "Get started",
    features: [
      "Everything in Startup",
      agents("growth"),
      members("growth"),
      retention("growth"),
      ...granted(PLANS.growth.auditExport, "Audit log export"),
    ],
  },
  {
    id: "business",
    name: PLANS.business.name,
    price: price("business"),
    priceSuffix: "/month",
    description: "For organizations running agents at scale.",
    cta: "Get started",
    features: [
      "Everything in Growth",
      agents("business"),
      members("business"),
      retention("business"),
    ],
  },
  {
    id: "enterprise",
    name: PLANS.enterprise.name,
    price: price("enterprise"),
    description: "For organizations with custom security and compliance needs.",
    cta: "Talk to an AI infrastructure specialist",
    features: [
      "Custom limits",
      "Dedicated support",
      "Custom contracts",
      "Advanced compliance support",
    ],
  },
];
