import { describe, expect, it } from "vitest";
import { actionMatches, filterApplicablePolicies, policyMatches, resolveBestPermission } from "@/lib/policies/matcher";
import { AGENT_1, AGENT_2, makeCondition, makeInput, makePermission, makePolicy } from "@/lib/policies/__tests__/fixtures";

describe("actionMatches", () => {
  it("matches exact actions", () => {
    expect(actionMatches("refund.issue", "refund.issue")).toBe(true);
    expect(actionMatches("refund.issue", "refund.read")).toBe(false);
  });

  it("matches simple prefix wildcards", () => {
    expect(actionMatches("crm.*", "crm.contact.read")).toBe(true);
    expect(actionMatches("crm.*", "crm.export")).toBe(true);
    expect(actionMatches("crm.*", "invoice.read")).toBe(false);
  });
});

describe("policyMatches", () => {
  it("matches a policy scoped to a specific agent", () => {
    const policy = makePolicy({ agentId: AGENT_1, action: "refund.issue" });
    expect(policyMatches(policy, makeInput({ agentId: AGENT_1, action: "refund.issue" }))).toBe(true);
    expect(policyMatches(policy, makeInput({ agentId: AGENT_2, action: "refund.issue" }))).toBe(false);
  });

  it("an any-agent policy (agentId null) matches every agent", () => {
    const policy = makePolicy({ agentId: null, action: "customer.delete" });
    expect(policyMatches(policy, makeInput({ agentId: AGENT_1, action: "customer.delete" }))).toBe(true);
    expect(policyMatches(policy, makeInput({ agentId: AGENT_2, action: "customer.delete" }))).toBe(true);
  });

  it("requires all conditions to match (AND)", () => {
    const policy = makePolicy({
      action: "refund.issue",
      conditions: [
        makeCondition({ field: "context.amount", operator: "GREATER_THAN", value: 500 }),
        makeCondition({ field: "environment", operator: "EQUALS", value: "PRODUCTION" }),
      ],
    });

    expect(
      policyMatches(
        policy,
        makeInput({ action: "refund.issue", environment: "PRODUCTION", context: { amount: 1250 } })
      )
    ).toBe(true);

    expect(
      policyMatches(
        policy,
        makeInput({ action: "refund.issue", environment: "STAGING", context: { amount: 1250 } })
      )
    ).toBe(false);
  });

  it("a policy with no conditions matches on scope alone", () => {
    const policy = makePolicy({ action: "customer.delete", conditions: [] });
    expect(policyMatches(policy, makeInput({ action: "customer.delete" }))).toBe(true);
  });
});

describe("filterApplicablePolicies", () => {
  it("excludes disabled policies even if their scope matches", () => {
    const active = makePolicy({ status: "ACTIVE", action: "refund.issue" });
    const disabled = makePolicy({ status: "DISABLED", action: "refund.issue" });

    const result = filterApplicablePolicies([active, disabled], makeInput({ action: "refund.issue" }));

    expect(result.map((p) => p.id)).toEqual([active.id]);
  });
});

describe("resolveBestPermission", () => {
  it("prefers exact action + exact resource over broader rules", () => {
    const exact = makePermission({ action: "refund.issue", resource: "payment", decision: "REQUIRE_APPROVAL" });
    const any = makePermission({ action: "refund.issue", resource: "", decision: "ALLOW" });

    const result = resolveBestPermission([any, exact], makeInput({ action: "refund.issue", resource: "payment" }));
    expect(result?.id).toBe(exact.id);
  });

  it("falls back to a wildcard action when no exact action rule exists", () => {
    const wildcard = makePermission({ action: "crm.*", resource: "", decision: "BLOCK" });
    const result = resolveBestPermission([wildcard], makeInput({ action: "crm.export" }));
    expect(result?.id).toBe(wildcard.id);
  });

  it("exact action beats wildcard action regardless of resource specificity", () => {
    const wildcardWithResource = makePermission({ action: "crm.*", resource: "contact", decision: "BLOCK" });
    const exactAnyResource = makePermission({ action: "crm.export", resource: "", decision: "ALLOW" });

    const result = resolveBestPermission(
      [wildcardWithResource, exactAnyResource],
      makeInput({ action: "crm.export", resource: "contact" })
    );
    expect(result?.id).toBe(exactAnyResource.id);
  });

  it("returns undefined when nothing applies", () => {
    const permission = makePermission({ action: "invoice.read" });
    expect(resolveBestPermission([permission], makeInput({ action: "refund.issue" }))).toBeUndefined();
  });
});
