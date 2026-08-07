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

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    description: "Try Aegis on a small set of agents.",
    cta: "Get started",
    features: [
      "3 agents",
      "Basic activity monitoring",
      "7-day activity history",
      "Basic cost visibility",
    ],
  },
  {
    id: "startup",
    name: "Startup",
    price: "$99",
    priceSuffix: "/month",
    description: "For teams putting their first agents into production.",
    cta: "Get started",
    features: [
      "10 agents",
      "Full activity monitoring",
      "Cost tracking",
      "Policies",
      "Approvals",
      "Alerts",
      "30-day activity history",
      "5 members",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: "$299",
    priceSuffix: "/month",
    description: "For companies scaling their AI agent workforce.",
    featured: true,
    cta: "Get started",
    features: [
      "50 agents",
      "Advanced policies",
      "Security monitoring",
      "Advanced cost analytics",
      "90-day activity history",
      "Team permissions",
      "Integrations",
      "20 members",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: "$999",
    priceSuffix: "/month",
    description: "For organizations running agents at scale.",
    cta: "Get started",
    features: [
      "Higher agent limits",
      "Advanced RBAC",
      "Audit exports",
      "Long-term retention",
      "Advanced security",
      "SSO-ready architecture",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "For organizations with custom security and compliance needs.",
    cta: "Contact us",
    features: [
      "Custom limits",
      "Dedicated support",
      "Custom contracts",
      "Advanced compliance support",
    ],
  },
];
