/** P0 §1/§2 — trusted server-side decision context and kill-switch states. */
import { describe, expect, it } from "vitest";

import { buildDecisionContext, isAgentHalted } from "@/lib/policies/decision-context";
import { makeInput } from "@/lib/policies/__tests__/fixtures";

const prodLowAgent = { environment: "PRODUCTION" as const, riskLevel: "LOW" as const };

describe("environment", () => {
  it("uses the agent's own environment when the caller omits it", () => {
    const { matchInput, claimedEnvironment } = buildDecisionContext(makeInput({ environment: undefined }), prodLowAgent, "STRICT");
    expect(matchInput.environment).toBe("PRODUCTION");
    expect(claimedEnvironment).toBeUndefined();
  });

  it("ignores a different caller-claimed environment and keeps the claim as evidence", () => {
    const { matchInput, claimedEnvironment } = buildDecisionContext(makeInput({ environment: "STAGING" }), prodLowAgent, "STRICT");
    expect(matchInput.environment).toBe("PRODUCTION");
    expect(claimedEnvironment).toBe("STAGING");
  });

  it("lets a dashboard operator explicitly simulate an environment (policy tester)", () => {
    const { matchInput, claimedEnvironment } = buildDecisionContext(
      makeInput({ environment: "STAGING", contextSource: "operator" }),
      prodLowAgent,
      "STRICT"
    );
    expect(matchInput.environment).toBe("STAGING");
    expect(claimedEnvironment).toBeUndefined();
  });
});

describe("riskLevel floor", () => {
  it("can't be lowered below Aegis's own score of the action", () => {
    const { matchInput, claimedRiskLevel } = buildDecisionContext(
      makeInput({ action: "customer.delete", riskLevel: "LOW" }),
      prodLowAgent,
      "STRICT"
    );
    expect(matchInput.riskLevel).toBe("HIGH");
    expect(claimedRiskLevel).toBe("LOW");
  });

  it("can't be lowered below the agent's configured risk level", () => {
    const { matchInput } = buildDecisionContext(
      makeInput({ action: "docs.read", riskLevel: "LOW" }),
      { environment: "PRODUCTION", riskLevel: "HIGH" },
      "STRICT"
    );
    expect(matchInput.riskLevel).toBe("HIGH");
  });

  it("can be raised by the caller", () => {
    const { matchInput, claimedRiskLevel } = buildDecisionContext(
      makeInput({ action: "docs.read", riskLevel: "CRITICAL" }),
      prodLowAgent,
      "STRICT"
    );
    expect(matchInput.riskLevel).toBe("CRITICAL");
    expect(claimedRiskLevel).toBeUndefined();
  });

  it("is always set, even when the caller sends nothing", () => {
    expect(buildDecisionContext(makeInput({ action: "docs.read" }), prodLowAgent, "STRICT").matchInput.riskLevel).toBe("LOW");
  });
});

describe("LEGACY mode", () => {
  it("passes the caller's input through untouched (pre-P0 behavior)", () => {
    const input = makeInput({ action: "customer.delete", environment: undefined, riskLevel: "LOW" });
    const { matchInput, claimedEnvironment, claimedRiskLevel } = buildDecisionContext(input, prodLowAgent, "LEGACY");
    expect(matchInput).toBe(input);
    expect(claimedEnvironment).toBeUndefined();
    expect(claimedRiskLevel).toBeUndefined();
  });
});

describe("isAgentHalted", () => {
  it("treats STOPPED, PAUSED and ARCHIVED as halted", () => {
    expect(isAgentHalted("STOPPED")).toBe(true);
    expect(isAgentHalted("PAUSED")).toBe(true);
    expect(isAgentHalted("ARCHIVED")).toBe(true);
  });

  it("evaluates ACTIVE and NEEDS_ATTENTION normally", () => {
    expect(isAgentHalted("ACTIVE")).toBe(false);
    expect(isAgentHalted("NEEDS_ATTENTION")).toBe(false);
  });
});
