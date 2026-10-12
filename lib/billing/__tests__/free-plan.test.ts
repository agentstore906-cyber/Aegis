import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { canCreateAgent, canUseAdvancedPolicies } from "@/lib/billing/entitlements";
import { DEFAULT_PLAN_ID, getPlan, isPlanId, PLANS } from "@/lib/billing/plans";
import { PRICING_PLANS } from "@/lib/pricing";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("Free plan definition", () => {
  it("is $0 with three agents and no Paddle price (nothing to pay for the first three agents)", () => {
    expect(PLANS.free).toMatchObject({ priceCents: 0, agentLimit: 3, paddlePriceId: null, advancedPolicies: false, activityRetentionDays: 7 });
    for (let used = 0; used < 3; used++) expect(canCreateAgent("free", used)).toEqual({ allowed: true });
    expect(canCreateAgent("free", 3).allowed).toBe(false);
  });

  it("the pricing card is derived from the plan and presents the Free Risk Scanner", () => {
    const free = PRICING_PLANS.find((p) => p.id === "free")!;
    expect(free.features).toContain("3 agents");
    expect(free.features).toContain("Free Risk Scanner");
    expect(free.features).toContain("7-day activity history");
  });

  it("Startup's card advertises the conditions the entitlement actually grants it", () => {
    expect(PLANS.startup.advancedPolicies).toBe(true);
    expect(PRICING_PLANS.find((p) => p.id === "startup")!.features).toContain("Policy conditions (advanced policies)");
  });
});

describe("Organization.plan: default, validation and unknown values", () => {
  it("defaults to free at the database level (new and pre-existing rows)", () => {
    expect(read("prisma/schema.prisma")).toMatch(/plan\s+String\s+@default\("free"\)/);
    expect(DEFAULT_PLAN_ID).toBe("free");
  });

  it("isPlanId only accepts plans this build defines", () => {
    for (const id of Object.keys(PLANS)) expect(isPlanId(id)).toBe(true);
    for (const bad of ["", "Free", "pro", "legacy-plan", null, undefined]) expect(isPlanId(bad as string | null | undefined)).toBe(false);
  });

  it("unknown values get Free entitlements (grants nothing extra) — and the retention job skips them instead", () => {
    expect(getPlan("legacy-plan").id).toBe("free");
    expect(canUseAdvancedPolicies("legacy-plan").allowed).toBe(false);
    expect(canCreateAgent("legacy-plan", 3).allowed).toBe(false);
    expect(read("lib/retention/activity.ts")).toMatch(/isPlanId\(org\.plan\)/);
  });

  it("the only code that writes Organization.plan on a paid event derives it from a known plan (billing sync)", () => {
    // The plan written to the organization comes from the decision (resolved from a configured price, or Free for an
    // ended subscription) — never from a Free fallback for an unidentified paid price (see subscription-decision.test.ts).
    expect(read("lib/billing/sync.ts")).toMatch(/plan:\s*decision\.plan/);
    expect(read("lib/billing/sync.ts")).not.toMatch(/planIdForPriceId/);
  });
});
