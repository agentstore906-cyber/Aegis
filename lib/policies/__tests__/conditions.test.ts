import { describe, expect, it } from "vitest";
import { evaluateOperator, resolveField } from "@/lib/policies/conditions";
import type { PolicyEvaluationInput } from "@/lib/policies/types";

const baseInput: PolicyEvaluationInput = {
  organizationId: "org_1",
  agentId: "agent_1",
  action: "refund.issue",
  resource: "payment",
  environment: "PRODUCTION",
  tool: "billing",
  riskLevel: "HIGH",
  context: { amount: 1250, customer: "Acme Inc.", approved: false },
};

describe("resolveField", () => {
  it("resolves context.* paths", () => {
    expect(resolveField("context.amount", baseInput)).toBe(1250);
    expect(resolveField("context.customer", baseInput)).toBe("Acme Inc.");
  });

  it("resolves whitelisted top-level fields", () => {
    expect(resolveField("environment", baseInput)).toBe("PRODUCTION");
    expect(resolveField("riskLevel", baseInput)).toBe("HIGH");
    expect(resolveField("action", baseInput)).toBe("refund.issue");
  });

  it("returns undefined for missing context keys", () => {
    expect(resolveField("context.doesNotExist", baseInput)).toBeUndefined();
  });

  it("returns undefined for non-whitelisted fields (never arbitrary property access)", () => {
    expect(resolveField("organizationId", baseInput)).toBeUndefined();
    expect(resolveField("__proto__.polluted", baseInput)).toBeUndefined();
  });

  it("guards against prototype-pollution keys inside context", () => {
    const input = { ...baseInput, context: { __proto__: { amount: 1 } } } as PolicyEvaluationInput;
    expect(resolveField("context.__proto__.amount", input)).toBeUndefined();
  });
});

describe("evaluateOperator", () => {
  it("EQUALS / NOT_EQUALS compare across types via string coercion", () => {
    expect(evaluateOperator("EQUALS", "production", "production")).toBe(true);
    expect(evaluateOperator("EQUALS", "PRODUCTION", "production")).toBe(false);
    expect(evaluateOperator("NOT_EQUALS", "staging", "production")).toBe(true);
    expect(evaluateOperator("EQUALS", undefined, "production")).toBe(false);
  });

  it("numeric operators compare numbers correctly", () => {
    expect(evaluateOperator("GREATER_THAN", 1250, 500)).toBe(true);
    expect(evaluateOperator("GREATER_THAN", 250, 500)).toBe(false);
    expect(evaluateOperator("GREATER_THAN_OR_EQUAL", 500, 500)).toBe(true);
    expect(evaluateOperator("LESS_THAN", 100, 500)).toBe(true);
    expect(evaluateOperator("LESS_THAN_OR_EQUAL", 500, 500)).toBe(true);
  });

  it("does not silently coerce non-numeric strings for numeric operators", () => {
    expect(evaluateOperator("GREATER_THAN", "hello", 500)).toBe(false);
    expect(evaluateOperator("GREATER_THAN", 500, "hello")).toBe(false);
  });

  it("IN / NOT_IN check membership", () => {
    expect(evaluateOperator("IN", "gold", ["gold", "platinum"])).toBe(true);
    expect(evaluateOperator("IN", "silver", ["gold", "platinum"])).toBe(false);
    expect(evaluateOperator("NOT_IN", "silver", ["gold", "platinum"])).toBe(true);
    expect(evaluateOperator("IN", "gold", "not-an-array")).toBe(false);
  });

  it("EXISTS checks presence, ignoring the configured value", () => {
    expect(evaluateOperator("EXISTS", 0, true)).toBe(true);
    expect(evaluateOperator("EXISTS", "", true)).toBe(true);
    expect(evaluateOperator("EXISTS", undefined, true)).toBe(false);
    expect(evaluateOperator("EXISTS", null, true)).toBe(false);
  });
});
