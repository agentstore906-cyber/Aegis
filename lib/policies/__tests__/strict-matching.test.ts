/**
 * P0 §2 — policy field-omission bypass regression tests. Pure matcher /
 * resolver functions only; the end-to-end versions (through
 * evaluateAgentAction against Postgres) live in
 * lib/__tests__/p0-decision-correctness.integration.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  filterApplicablePolicies,
  policyMatches,
  resolveBestPermission,
} from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { evaluateConditionStrict } from "@/lib/policies/conditions";
import { makeCondition, makeInput, makePermission, makePolicy } from "@/lib/policies/__tests__/fixtures";

describe("scope fields the caller omitted (STRICT)", () => {
  const blockPaymentsInProd = makePolicy({ action: "payments.*", environment: "PRODUCTION", decision: "BLOCK" });

  it("BLOCK payments in PRODUCTION still applies when `environment` is omitted", () => {
    const input = makeInput({ action: "payments.transfer", environment: undefined });
    expect(policyMatches(blockPaymentsInProd, input)).toBe(true);
  });

  it("still applies to an explicit PRODUCTION and not to an explicit STAGING", () => {
    expect(policyMatches(blockPaymentsInProd, makeInput({ action: "payments.transfer", environment: "PRODUCTION" }))).toBe(true);
    expect(policyMatches(blockPaymentsInProd, makeInput({ action: "payments.transfer", environment: "STAGING" }))).toBe(false);
  });

  it("an omitted field never makes an ALLOW policy apply", () => {
    const allowInProd = makePolicy({ action: "payments.*", environment: "PRODUCTION", decision: "ALLOW" });
    expect(policyMatches(allowInProd, makeInput({ action: "payments.transfer", environment: undefined }))).toBe(false);
  });

  it("applies to omitted `tool` and `resource` for REQUIRE_APPROVAL and ALERT too", () => {
    const viaStripe = makePolicy({ action: "payments.*", tool: "stripe", decision: "REQUIRE_APPROVAL" });
    const onVip = makePolicy({ action: "crm.export", resource: "vip-accounts", decision: "ALERT" });
    expect(policyMatches(viaStripe, makeInput({ action: "payments.transfer", tool: undefined }))).toBe(true);
    expect(policyMatches(onVip, makeInput({ action: "crm.export", resource: undefined }))).toBe(true);
    expect(policyMatches(onVip, makeInput({ action: "crm.export", resource: "other" }))).toBe(false);
  });

  it("LEGACY mode keeps the pre-P0 behavior (omitted field = policy does not match)", () => {
    const input = makeInput({ action: "payments.transfer", environment: undefined });
    expect(policyMatches(blockPaymentsInProd, input, "LEGACY")).toBe(false);
  });

  it("end to end: an ALLOW permission no longer wins over a scoped BLOCK when environment is omitted", () => {
    const input = makeInput({ action: "payments.transfer", environment: undefined });
    const permission = resolveBestPermission([makePermission({ action: "payments.*", decision: "ALLOW" })], input);
    const resolved = resolveDecision(permission, filterApplicablePolicies([blockPaymentsInProd], input), input);
    expect(resolved.decision).toBe("BLOCK");
  });
});

describe("riskLevel scope", () => {
  it("is a threshold for restrictive policies: a riskier action can't escape a rule written for a milder one", () => {
    const approveHigh = makePolicy({ action: "crm.*", riskLevel: "HIGH", decision: "REQUIRE_APPROVAL" });
    expect(policyMatches(approveHigh, makeInput({ action: "crm.export", riskLevel: "CRITICAL" }))).toBe(true);
    expect(policyMatches(approveHigh, makeInput({ action: "crm.export", riskLevel: "HIGH" }))).toBe(true);
    expect(policyMatches(approveHigh, makeInput({ action: "crm.export", riskLevel: "MEDIUM" }))).toBe(false);
    expect(policyMatches(approveHigh, makeInput({ action: "crm.export", riskLevel: undefined }))).toBe(true);
  });

  it("stays exact for ALLOW policies — never widened to riskier actions", () => {
    const allowMedium = makePolicy({ action: "crm.*", riskLevel: "MEDIUM", decision: "ALLOW" });
    expect(policyMatches(allowMedium, makeInput({ action: "crm.export", riskLevel: "MEDIUM" }))).toBe(true);
    expect(policyMatches(allowMedium, makeInput({ action: "crm.export", riskLevel: "HIGH" }))).toBe(false);
    expect(policyMatches(allowMedium, makeInput({ action: "crm.export", riskLevel: "LOW" }))).toBe(false);
  });

  it("LEGACY mode keeps exact equality", () => {
    const approveHigh = makePolicy({ action: "crm.*", riskLevel: "HIGH", decision: "REQUIRE_APPROVAL" });
    expect(policyMatches(approveHigh, makeInput({ action: "crm.export", riskLevel: "CRITICAL" }), "LEGACY")).toBe(false);
  });
});

describe("conditions on fields the caller omitted or sent unusable values for", () => {
  const blockLargeRefunds = makePolicy({
    action: "refund.issue",
    decision: "BLOCK",
    conditions: [makeCondition({ field: "context.amount", operator: "GREATER_THAN", value: 1000 })],
  });

  it("applies when `amount` is omitted", () => {
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: {} }))).toBe(true);
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: undefined }))).toBe(true);
  });

  it("applies when `amount` is not a number, or null", () => {
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: { amount: "lots" } }))).toBe(true);
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: { amount: null } }))).toBe(true);
  });

  it("is still evaluated normally when `amount` is present", () => {
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: { amount: 50 } }))).toBe(false);
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: { amount: 5000 } }))).toBe(true);
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: { amount: "5000" } }))).toBe(true);
  });

  it("an ALLOW policy's condition on a missing field does not match", () => {
    const allowSmall = makePolicy({
      action: "refund.issue",
      decision: "ALLOW",
      conditions: [makeCondition({ field: "context.amount", operator: "LESS_THAN", value: 100 })],
    });
    expect(policyMatches(allowSmall, makeInput({ action: "refund.issue", context: {} }))).toBe(false);
    expect(policyMatches(allowSmall, makeInput({ action: "refund.issue", context: { amount: "tiny" } }))).toBe(false);
    expect(policyMatches(allowSmall, makeInput({ action: "refund.issue", context: { amount: 10 } }))).toBe(true);
  });

  it("EXISTS is never indeterminate — absence is a definite false", () => {
    const blockIfOverride = makePolicy({
      action: "refund.issue",
      decision: "BLOCK",
      conditions: [makeCondition({ field: "context.override", operator: "EXISTS", value: null })],
    });
    expect(policyMatches(blockIfOverride, makeInput({ action: "refund.issue", context: {} }))).toBe(false);
    expect(policyMatches(blockIfOverride, makeInput({ action: "refund.issue", context: { override: true } }))).toBe(true);
  });

  it("LEGACY mode keeps pre-P0 semantics (missing field = condition false)", () => {
    expect(policyMatches(blockLargeRefunds, makeInput({ action: "refund.issue", context: {} }), "LEGACY")).toBe(false);
  });
});

describe("evaluateConditionStrict", () => {
  it("returns null (indeterminate) for missing, null, and non-comparable values", () => {
    expect(evaluateConditionStrict("GREATER_THAN", undefined, 10)).toBeNull();
    expect(evaluateConditionStrict("EQUALS", null, "x")).toBeNull();
    expect(evaluateConditionStrict("LESS_THAN", "abc", 10)).toBeNull();
    expect(evaluateConditionStrict("IN", "a", "not-an-array")).toBeNull();
  });

  it("returns real booleans when the comparison can be made", () => {
    expect(evaluateConditionStrict("GREATER_THAN", 11, 10)).toBe(true);
    expect(evaluateConditionStrict("NOT_IN", "c", ["a", "b"])).toBe(true);
    expect(evaluateConditionStrict("EXISTS", undefined, null)).toBe(false);
  });
});

describe("resource-scoped permissions when `resource` is omitted", () => {
  const permissions = [
    makePermission({ action: "crm.export", resource: "", decision: "ALLOW" }),
    makePermission({ action: "crm.export", resource: "vip-accounts", decision: "BLOCK" }),
  ];

  it("a resource-scoped BLOCK can't be dodged by not naming the resource", () => {
    expect(resolveBestPermission(permissions, makeInput({ action: "crm.export", resource: undefined }))?.decision).toBe("BLOCK");
  });

  it("naming a different resource still gets the any-resource ALLOW", () => {
    expect(resolveBestPermission(permissions, makeInput({ action: "crm.export", resource: "smb" }))?.decision).toBe("ALLOW");
  });

  it("a resource-scoped ALLOW is never credited to a request that didn't name it", () => {
    const onlyScopedAllow = [makePermission({ action: "crm.export", resource: "smb", decision: "ALLOW" })];
    expect(resolveBestPermission(onlyScopedAllow, makeInput({ action: "crm.export", resource: undefined }))).toBeUndefined();
  });

  it("LEGACY mode ignores resource-scoped rows when resource is omitted (pre-P0)", () => {
    expect(
      resolveBestPermission(permissions, makeInput({ action: "crm.export", resource: undefined }), "LEGACY")?.decision
    ).toBe("ALLOW");
  });
});
