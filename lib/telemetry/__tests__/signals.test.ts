/** P1 §1 — risk signals are deterministic, explainable observations. */
import { describe, expect, it } from "vitest";

import { buildRiskSignals } from "@/lib/telemetry/signals";

const base = {
  scoredRule: null,
  scoredLevel: "LOW" as const,
  agentRiskLevel: "LOW" as const,
  dataClasses: [],
  dataSensitivity: null,
  secretShapedFieldCount: 0,
  secretValueRedactions: { count: 0, kinds: [] },
};
const codes = (input: Parameters<typeof buildRiskSignals>[0]) => buildRiskSignals(input).map((s) => s.code);

describe("buildRiskSignals", () => {
  it("records nothing when nothing notable was observed", () => {
    expect(buildRiskSignals(base)).toEqual([]);
  });

  it("names the scoring rule and the agent floor", () => {
    expect(codes({ ...base, scoredRule: "delete_data", scoredLevel: "HIGH" })).toEqual(["risk_rule"]);
    expect(codes({ ...base, agentRiskLevel: "HIGH" })).toEqual(["agent_risk_floor"]);
  });

  it("records ignored caller claims with both values", () => {
    const signals = buildRiskSignals({
      ...base,
      claimedRiskLevel: "LOW",
      effectiveRiskLevel: "HIGH",
      claimedEnvironment: "STAGING",
      effectiveEnvironment: "PRODUCTION",
    });
    expect(signals).toEqual([
      { code: "claimed_risk_lower", detail: { claimed: "LOW", effective: "HIGH" } },
      { code: "claimed_environment_ignored", detail: { claimed: "STAGING", effective: "PRODUCTION" } },
    ]);
  });

  it("flags HIGH+ sensitivity data, secret-shaped fields and redacted secret values (counts and kinds only)", () => {
    const signals = buildRiskSignals({
      ...base,
      dataClasses: ["PII"],
      dataSensitivity: "HIGH",
      secretShapedFieldCount: 2,
      secretValueRedactions: { count: 1, kinds: ["jwt"] },
    });
    expect(signals.map((s) => s.code)).toEqual(["sensitive_data", "secret_shaped_fields", "secret_values_redacted"]);
    expect(codes({ ...base, dataClasses: ["INTERNAL"], dataSensitivity: "MEDIUM" })).toEqual([]);
  });

  it("records an execution that succeeded under a BLOCK / REQUIRE_APPROVAL decision, but not a failed one", () => {
    expect(codes({ ...base, evaluationDecision: "BLOCK", outcome: "SUCCESS" })).toEqual(["executed_despite_decision"]);
    expect(codes({ ...base, evaluationDecision: "REQUIRE_APPROVAL", outcome: "WARNING" })).toEqual(["executed_despite_decision"]);
    expect(codes({ ...base, evaluationDecision: "BLOCK", outcome: "FAILURE" })).toEqual([]);
    expect(codes({ ...base, evaluationDecision: "ALLOW", outcome: "SUCCESS" })).toEqual([]);
  });
});
