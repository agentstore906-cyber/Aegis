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
 * Numeric claims (agent count, member count, retention days, price) are
 * interpolated from `lib/billing/plans.ts` — the same config
 * `lib/billing/entitlements.ts` actually enforces — so this page can never
 * quietly drift from what the product enforces. Qualitative bullets
 * ("Priority support," "Custom contracts," ...) stay hand-written; there's
 * no entitlement to derive them from.
 */
const agents = (id: keyof typeof PLANS) => (PLANS[id].agentLimit === null ? "Unlimited agents" : `${PLANS[id].agentLimit} agents`);
const members = (id: keyof typeof PLANS) => (PLANS[id].memberLimit === null ? "Unlimited members" : `${PLANS[id].memberLimit} members`);
const retention = (id: keyof typeof PLANS) => `${PLANS[id].activityRetentionDays}-day activity history`;
const price = (id: keyof typeof PLANS) => (PLANS[id].priceCents === null ? "Custom" : formatCurrency(PLANS[id].priceCents!));

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: PLANS.free.name,
    price: price("free"),
    description: "Try Aegis on a small set of agents.",
    cta: "Get started",
    features: [agents("free"), "Basic activity monitoring", retention("free"), "Basic cost visibility"],
  },
  {
    id: "startup",
    name: PLANS.startup.name,
    price: price("startup"),
    priceSuffix: "/month",
    description: "For teams putting their first agents into production.",
    cta: "Get started",
    features: [
      agents("startup"),
      "Full activity monitoring",
      "Cost tracking",
      "Policies",
      "Approvals",
      "Alerts",
      retention("startup"),
      members("startup"),
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
      agents("growth"),
      "Advanced policies",
      "Security monitoring",
      "Advanced cost analytics",
      retention("growth"),
      "Team permissions",
      "Integrations",
      members("growth"),
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
      agents("business"),
      "Advanced RBAC",
      "Audit exports",
      retention("business"),
      "Advanced security",
      "SSO-ready architecture",
      "Priority support",
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
