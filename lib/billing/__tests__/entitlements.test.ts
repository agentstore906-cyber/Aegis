import { describe, expect, it } from "vitest";
import {
  canCreateAgent,
  canInviteMember,
  canCreateApiKey,
  canCreateWebhook,
  canUseAdvancedPolicies,
  canExportAudit,
} from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";

describe("canCreateAgent", () => {
  it("allows creation below the plan's agent limit", () => {
    expect(canCreateAgent("free", 0)).toEqual({ allowed: true });
    expect(canCreateAgent("free", PLANS.free.agentLimit! - 1)).toEqual({ allowed: true });
  });

  it("blocks creation at or above the plan's agent limit, with an upgrade target", () => {
    const result = canCreateAgent("free", PLANS.free.agentLimit!);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("Free");
      expect(result.reason).toContain(String(PLANS.free.agentLimit));
      expect(result.upgradeTo).toBe("startup");
    }
  });

  it("never blocks a plan with an unlimited (null) limit", () => {
    expect(canCreateAgent("enterprise", 1_000_000)).toEqual({ allowed: true });
  });

  it("falls back to the free plan's limit for an unrecognized/legacy plan string", () => {
    expect(canCreateAgent("some-legacy-plan-string", PLANS.free.agentLimit!)).toEqual(
      expect.objectContaining({ allowed: false })
    );
  });

  it("suggests the next plan that actually raises the limit, not just the adjacent one", () => {
    // Growth and Startup both have real, increasing agent limits, so the
    // immediate next plan should be suggested.
    const result = canCreateAgent("startup", PLANS.startup.agentLimit!);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.upgradeTo).toBe("growth");
  });
});

describe("canInviteMember", () => {
  it("allows and blocks based on the plan's member limit", () => {
    expect(canInviteMember("startup", 0)).toEqual({ allowed: true });
    const result = canInviteMember("startup", PLANS.startup.memberLimit!);
    expect(result.allowed).toBe(false);
  });
});

describe("canCreateApiKey", () => {
  it("allows and blocks based on the plan's API key limit", () => {
    expect(canCreateApiKey("free", 0)).toEqual({ allowed: true });
    const result = canCreateApiKey("free", PLANS.free.apiKeyLimit!);
    expect(result.allowed).toBe(false);
  });
});

describe("boolean feature gates", () => {
  it("gates webhooks off on Free, on for paid plans", () => {
    expect(canCreateWebhook("free")).toEqual(expect.objectContaining({ allowed: false }));
    expect(canCreateWebhook("startup")).toEqual({ allowed: true });
  });

  it("gates advanced policies off on Free, on for paid plans", () => {
    expect(canUseAdvancedPolicies("free")).toEqual(expect.objectContaining({ allowed: false }));
    expect(canUseAdvancedPolicies("startup")).toEqual({ allowed: true });
  });

  it("gates audit export to Growth and above", () => {
    expect(canExportAudit("free")).toEqual(expect.objectContaining({ allowed: false }));
    expect(canExportAudit("startup")).toEqual(expect.objectContaining({ allowed: false }));
    expect(canExportAudit("growth")).toEqual({ allowed: true });
  });
});
