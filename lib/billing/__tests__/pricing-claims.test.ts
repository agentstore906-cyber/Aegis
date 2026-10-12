import { describe, expect, it } from "vitest";

import { PLANS, type PlanId } from "@/lib/billing/plans";
import { PRICING_PLANS } from "@/lib/pricing";

const card = (id: PlanId) => PRICING_PLANS.find((p) => p.id === id)!;
const text = (id: PlanId) => card(id).features.join(" | ").toLowerCase();

/**
 * Every visible pricing-card claim must be backed by backend enforcement (or be available on every plan, or be an
 * explicit human commitment). These phrases were removed because no plan check exists behind them.
 */
describe("pricing cards make no unsupported claims", () => {
  const unsupported = [
    "full activity monitoring",
    "basic activity monitoring",
    "security monitoring",
    "cost analytics",
    "basic cost visibility",
    "team permissions",
    "advanced rbac",
    "advanced security",
    "sso",
    "integrations",
  ];
  it.each(PRICING_PLANS.map((p) => p.id))("%s has none of the removed claims", (id) => {
    for (const phrase of unsupported) expect(text(id as PlanId)).not.toContain(phrase);
  });

  it("boolean entitlements are advertised exactly where PLANS grants them", () => {
    for (const plan of PRICING_PLANS) {
      const config = PLANS[plan.id as PlanId];
      const t = text(plan.id as PlanId);
      // Only the card where the entitlement is first granted names it; later cards inherit via "Everything in …".
      const entitlementFirstGrantedHere = (flag: "advancedPolicies" | "webhooks" | "auditExport") => {
        const order: PlanId[] = ["free", "startup", "growth", "business", "enterprise"];
        const i = order.indexOf(config.id);
        return config[flag] && (i === 0 || !PLANS[order[i - 1]][flag]);
      };
      expect(t.includes("policy conditions")).toBe(entitlementFirstGrantedHere("advancedPolicies"));
      expect(t.includes("webhooks")).toBe(entitlementFirstGrantedHere("webhooks"));
      expect(t.includes("audit log export")).toBe(entitlementFirstGrantedHere("auditExport"));
    }
  });

  it("Advanced policies is not presented as a Growth upgrade over Startup (both plans have it)", () => {
    expect(PLANS.startup.advancedPolicies).toBe(true);
    expect(PLANS.growth.advancedPolicies).toBe(true);
    expect(text("growth")).not.toContain("polic");
    expect(card("growth").features).toContain("Everything in Startup");
  });

  it("numeric limits shown match the enforced limits", () => {
    for (const id of ["free", "startup", "growth", "business"] as PlanId[]) {
      expect(card(id).features).toContain(`${PLANS[id].agentLimit} agents`);
      expect(card(id).features).toContain(`${PLANS[id].memberLimit} members`);
      expect(card(id).features).toContain(`${PLANS[id].activityRetentionDays}-day activity history`);
    }
  });

  it("Free keeps the scanner and the essential controls, and does not list entitlements it lacks", () => {
    const free = text("free");
    expect(free).toContain("free risk scanner");
    expect(free).toContain("policies, approvals and security alerts");
    expect(PLANS.free).toMatchObject({ advancedPolicies: false, webhooks: false, auditExport: false });
    expect(free).not.toContain("webhooks");
    expect(free).not.toContain("conditions");
    expect(free).not.toContain("export");
  });
});

describe("finalized pricing decisions", () => {
  it("webhooks: enforced and advertised from Startup up, denied on Free with a pointer to Startup", async () => {
    const { canCreateWebhook } = await import("@/lib/billing/entitlements");
    for (const id of ["startup", "growth", "business", "enterprise"] as PlanId[]) expect(canCreateWebhook(id)).toEqual({ allowed: true });
    const denied = canCreateWebhook("free");
    expect(denied).toMatchObject({ allowed: false, upgradeTo: "startup" });
    if (!denied.allowed) expect(denied.reason).toContain("Upgrade to the Startup plan");
    expect(card("startup").features).toContain("Outbound webhooks");
  });

  it("no Priority support claim anywhere on the cards", () => {
    for (const plan of PRICING_PLANS) expect(text(plan.id as PlanId)).not.toContain("priority support");
  });
});
