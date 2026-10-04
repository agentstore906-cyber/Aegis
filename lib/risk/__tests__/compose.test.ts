import { describe, expect, it } from "vitest";

import { buildShadow, composeRisk, formatAssessment, finalizeAssessment } from "@/lib/risk/compose";
import { RISK_METHODOLOGY_VERSION } from "@/lib/risk/config";
import type { RiskDeviationInput, RiskInputs } from "@/lib/risk/types";

const now = new Date("2026-10-05T12:00:00.000Z");

function inputs(overrides: Partial<RiskInputs> = {}): RiskInputs {
  return {
    action: "crm.read",
    policy: { policyDecision: "ALLOW", explicitRuleMatched: true, matchedPermission: { id: "perm_1", action: "crm.read", decision: "ALLOW" } },
    request: { scoredRule: null, scoredLevel: "LOW", dataSensitivity: "LOW", dataClasses: ["PUBLIC"] },
    baseline: { version: 3, maturity: "ESTABLISHED", computedAt: new Date("2026-10-05T00:00:00.000Z") },
    deviations: [],
    trust: { state: "TRUSTED", score: 96, evaluatedAt: new Date("2026-10-05T11:55:00.000Z"), factors: [] },
    incidents: [],
    incidentsTruncated: false,
    now,
    ...overrides,
  };
}

const deviation = (kind: string, observed: Record<string, unknown>, confidence: RiskDeviationInput["confidence"] = "HIGH"): RiskDeviationInput => ({
  kind,
  dedupeKey: `${kind}:x`,
  confidence,
  observed,
  expected: {},
  explanation: `explanation for ${kind}`,
});

const newDestination = (confidence: RiskDeviationInput["confidence"] = "HIGH") =>
  deviation("NEW_DESTINATION", { dimension: "destination", value: "files.unknown.example", previouslySeen: null }, confidence);
const bigVolume = () => deviation("UNUSUAL_VOLUME", { unit: "records", value: 12_000, ratioToP95: 8.2 });
const sensitive = { scoredRule: null, scoredLevel: "LOW" as const, dataSensitivity: "HIGH" as const, dataClasses: ["PII"] };
const degraded = { state: "DEGRADED" as const, score: 52, evaluatedAt: new Date("2026-10-05T11:50:00.000Z"), factors: [{ code: "behavior.new_destination", summary: "New destination seen", points: 8 }] };

describe("low risk", () => {
  it("is LOW with no reasons and would ALLOW when nothing is flagged", () => {
    const core = composeRisk(inputs());
    expect(core.level).toBe("LOW");
    expect(core.reasons).toEqual([]);
    expect(core.headline).toBe("LOW RISK — no risk signals.");
    expect(core.escalation).toMatchObject({ applied: false, from: "LOW", to: "LOW" });
    expect(core.methodologyVersion).toBe(RISK_METHODOLOGY_VERSION);
    expect(buildShadow({ level: core.level, actual: "ALLOW", humanApproved: false })).toMatchObject({ recommended: "ALLOW", outcome: "AGREES" });
  });

  it("many LOW signals never add up to more than LOW", () => {
    const core = composeRisk(
      inputs({
        deviations: [
          deviation("NEW_END_USER", { dimension: "endUser", value: "hash" }),
          deviation("UNUSUAL_TIME", { hourOfDayUtc: 3 }),
          deviation("NEW_SERVICE", { dimension: "service", value: "billing-api" }),
          deviation("NEW_ACTION_TYPE", { dimension: "eventType", value: "FINANCIAL" }),
        ],
        incidents: [{ type: "policy_evaluation", id: "e1", at: new Date("2026-10-04T00:00:00Z"), outcome: "BLOCK" }],
      })
    );
    expect(core.reasons).toHaveLength(5);
    expect(core.reasons.every((r) => r.severity === "LOW")).toBe(true);
    expect(core.level).toBe("LOW");
    expect(core.escalation.applied).toBe(false);
  });
});

describe("medium risk", () => {
  it("a single MEDIUM signal is MEDIUM and maps to ALERT", () => {
    const core = composeRisk(inputs({ deviations: [newDestination()] }));
    expect(core.level).toBe("MEDIUM");
    expect(core.reasons).toHaveLength(1);
    expect(core.reasons[0]).toMatchObject({ code: "new_destination", family: "behavior", severity: "MEDIUM", rank: 1 });
    expect(buildShadow({ level: core.level, actual: "ALLOW", humanApproved: false })).toMatchObject({ riskDecision: "ALERT", recommended: "ALERT", outcome: "WOULD_ESCALATE" });
  });

  it("several MEDIUM signals from ONE family do not compound (they are correlated)", () => {
    const core = composeRisk(inputs({ deviations: [newDestination(), bigVolume(), deviation("UNUSUAL_SEQUENCE", { value: "a>b" })] }));
    expect(core.reasons).toHaveLength(3);
    expect(core.escalation.corroboratingFamilies).toEqual(["behavior"]);
    expect(core.level).toBe("MEDIUM");
  });

  it("the action-name keyword rule alone is weak: CRITICAL rule → MEDIUM, HIGH rule → LOW", () => {
    const critical = composeRisk(inputs({ request: { scoredRule: "export_sensitive_data", scoredLevel: "CRITICAL", dataSensitivity: "LOW", dataClasses: [] } }));
    expect(critical.reasons[0]).toMatchObject({ code: "high_risk_action", severity: "MEDIUM" });
    expect(critical.level).toBe("MEDIUM");
    const high = composeRisk(inputs({ request: { scoredRule: "delete_data", scoredLevel: "HIGH", dataSensitivity: "LOW", dataClasses: [] } }));
    expect(high.reasons[0]).toMatchObject({ code: "high_risk_action", severity: "LOW" });
    expect(high.level).toBe("LOW");
  });
});

describe("high risk and multiple signals", () => {
  it("the spec example: new destination + sensitive data + 8× volume + degraded trust → HIGH, with evidence for every reason", () => {
    const core = composeRisk(inputs({ request: sensitive, deviations: [newDestination(), bigVolume()], trust: degraded }));
    expect(core.level).toBe("HIGH");
    expect(core.headline).toBe("HIGH RISK — 3 independent kinds of evidence agree.");
    expect(core.escalation).toMatchObject({ applied: true, from: "MEDIUM", to: "HIGH" });
    expect(core.escalation.corroboratingFamilies.sort()).toEqual(["behavior", "history", "request"]);
    expect(core.reasons.map((r) => r.code).sort()).toEqual(["new_destination", "sensitive_data", "trust_degradation", "unusual_volume"]);
    expect(core.reasons.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (const reason of core.reasons) {
      expect(reason.evidence.length).toBeGreaterThan(0);
      expect(Object.keys(reason.evidence[0].detail).length).toBeGreaterThan(0);
    }
    const volume = core.reasons.find((r) => r.code === "unusual_volume")!;
    expect(volume.summary).toContain("8.2×");
    expect(volume.summary).toContain("12,000 records");
    expect(core.reasons.find((r) => r.code === "new_destination")!.summary).toContain("files.unknown.example");
    expect(core.reasons.find((r) => r.code === "trust_degradation")!.evidence[0].detail).toMatchObject({ state: "DEGRADED", score: 52 });
    expect(buildShadow({ level: core.level, actual: "ALLOW", humanApproved: false }).summary).toBe("Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL.");
  });

  it("escalates one step only, and never beyond CRITICAL", () => {
    const high = composeRisk(
      inputs({
        policy: { policyDecision: "BLOCK", explicitRuleMatched: true, winningPolicy: { id: "p1", name: "No exports", decision: "BLOCK", severity: "HIGH" } },
        request: { scoredRule: null, scoredLevel: "LOW", dataSensitivity: "CRITICAL", dataClasses: ["CREDENTIALS"] },
        deviations: [newDestination()],
        trust: { ...degraded, state: "RESTRICTED", score: 10 },
      })
    );
    expect(high.escalation).toMatchObject({ applied: true, from: "HIGH", to: "CRITICAL" });
    expect(high.level).toBe("CRITICAL");
    expect(high.escalation.corroboratingFamilies).toHaveLength(4);
    // CRITICAL still maps to REQUIRE_APPROVAL: BLOCK is never reachable from risk alone.
    expect(buildShadow({ level: "CRITICAL", actual: "ALLOW", humanApproved: false }).recommended).toBe("REQUIRE_APPROVAL");
  });

  it("two HIGH signals in the same family are HIGH, not CRITICAL", () => {
    const core = composeRisk(inputs({ trust: { ...degraded, state: "HIGH_RISK", score: 30 }, incidents: [1, 2].map((n) => ({ type: "policy_evaluation" as const, id: `e${n}`, at: now, outcome: "BLOCK" })) }));
    expect(core.escalation.corroboratingFamilies).toEqual(["history"]);
    expect(core.level).toBe("HIGH");
  });

  it("is deterministic: identical inputs yield an identical assessment", () => {
    const make = () => composeRisk(inputs({ request: sensitive, deviations: [newDestination(), bigVolume()], trust: degraded }));
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });
});

describe("conflicting signals", () => {
  it("the most severe signal sets the level; benign context never lowers it", () => {
    const core = composeRisk(inputs({ deviations: [newDestination()], trust: { state: "TRUSTED", score: 99, evaluatedAt: now, factors: [] } }));
    expect(core.level).toBe("MEDIUM");
  });

  it("a LOW-confidence deviation cannot raise anything above LOW, even for a MEDIUM-class deviation", () => {
    const core = composeRisk(inputs({ deviations: [newDestination("LOW")], baseline: { version: 1, maturity: "LIMITED_HISTORY", computedAt: now } }));
    expect(core.reasons[0]).toMatchObject({ code: "new_destination", severity: "LOW" });
    expect(core.level).toBe("LOW");
    expect(core.context.notes.map((n) => n.code)).toContain("baseline_limited_history");
  });

  it("a consumed human approval holds the recommendation at the actual decision, but the level and reasons are still shown", () => {
    const core = composeRisk(inputs({ request: sensitive, deviations: [newDestination()] }));
    expect(core.level).toBe("HIGH");
    const shadow = buildShadow({ level: core.level, actual: "ALLOW", humanApproved: true });
    expect(shadow).toMatchObject({ riskDecision: "REQUIRE_APPROVAL", recommended: "ALLOW", suppressedBy: "HUMAN_APPROVAL", outcome: "SUPPRESSED" });
    expect(shadow.summary).toContain("a human already approved this exact request");
  });

  it("the risk engine never recommends something weaker than what actually happened", () => {
    expect(buildShadow({ level: "LOW", actual: "BLOCK", humanApproved: false })).toMatchObject({ recommended: "BLOCK", outcome: "ACTUAL_STRICTER" });
    expect(buildShadow({ level: "MEDIUM", actual: "REQUIRE_APPROVAL", humanApproved: false })).toMatchObject({ recommended: "REQUIRE_APPROVAL", outcome: "ACTUAL_STRICTER" });
    expect(buildShadow({ level: "MEDIUM", actual: "ALERT", humanApproved: false })).toMatchObject({ recommended: "ALERT", outcome: "AGREES" });
  });
});

describe("missing context", () => {
  it("states what it could not know and produces no invented signals", () => {
    const core = composeRisk(inputs({ baseline: null, trust: null, request: { scoredRule: null, scoredLevel: "LOW", dataSensitivity: null, dataClasses: [] } }));
    expect(core.level).toBe("LOW");
    expect(core.reasons).toEqual([]);
    expect(core.context.baseline).toEqual({ status: "unavailable" });
    expect(core.context.trust).toEqual({ status: "unavailable" });
    expect(core.context.notes.map((n) => n.code).sort()).toEqual(["baseline_unavailable", "data_classification_not_reported", "trust_unavailable"]);
  });

  it("NEW_AGENT and stale trust are reported, not hidden", () => {
    const core = composeRisk(inputs({ baseline: { version: 1, maturity: "NEW_AGENT", computedAt: now }, trust: { ...degraded, evaluatedAt: new Date("2026-10-05T09:00:00Z") } }));
    expect(core.context.notes.map((n) => n.code).sort()).toEqual(["baseline_new_agent", "trust_stale"]);
    // Stale trust is still used.
    expect(core.reasons.map((r) => r.code)).toContain("trust_degradation");
  });
});

describe("trust interaction", () => {
  it.each([
    ["TRUSTED", undefined],
    ["NORMAL", undefined],
    ["DEGRADED", "MEDIUM"],
    ["HIGH_RISK", "HIGH"],
    ["RESTRICTED", "HIGH"],
  ] as const)("trust state %s → %s", (state, severity) => {
    const core = composeRisk(inputs({ trust: { state, score: 50, evaluatedAt: now, factors: [] } }));
    const reason = core.reasons.find((r) => r.code === "trust_degradation");
    expect(reason?.severity).toBe(severity);
  });

  it("degraded trust alone is MEDIUM, but agrees with a behavioral deviation to become HIGH (independent families)", () => {
    expect(composeRisk(inputs({ trust: degraded })).level).toBe("MEDIUM");
    expect(composeRisk(inputs({ trust: degraded, deviations: [newDestination()] })).level).toBe("HIGH");
  });

  it("trust and historical incidents are one family, so the same bad history is not counted twice", () => {
    const core = composeRisk(inputs({ trust: degraded, incidents: [1, 2].map((n) => ({ type: "policy_evaluation" as const, id: `e${n}`, at: now, outcome: "BLOCK" })) }));
    expect(core.reasons.map((r) => r.code).sort()).toEqual(["historical_incident", "trust_degradation"]);
    expect(core.escalation.applied).toBe(false);
    expect(core.level).toBe("MEDIUM");
  });
});

describe("policy interaction", () => {
  it("an explicit BLOCK or ALERT policy verdict is a HIGH / policy-severity violation signal", () => {
    const block = composeRisk(inputs({ policy: { policyDecision: "BLOCK", explicitRuleMatched: true, winningPolicy: { id: "p1", name: "No payments", decision: "BLOCK", severity: "LOW" } } }));
    expect(block.reasons[0]).toMatchObject({ code: "policy_violation", family: "policy", severity: "HIGH" });
    expect(block.reasons[0].evidence[0]).toMatchObject({ source: "policy", ref: "p1" });
    const alert = composeRisk(inputs({ policy: { policyDecision: "ALERT", explicitRuleMatched: true, winningPolicy: { id: "p2", name: "Watch exports", decision: "ALERT", severity: "MEDIUM" } } }));
    expect(alert.reasons[0]).toMatchObject({ code: "policy_violation", severity: "MEDIUM" });
    const critical = composeRisk(inputs({ policy: { policyDecision: "ALERT", explicitRuleMatched: true, winningPolicy: { id: "p3", name: "P", decision: "ALERT", severity: "CRITICAL" } } }));
    expect(critical.reasons[0].severity).toBe("HIGH");
  });

  it("default-deny and REQUIRE_APPROVAL are not violations (no rule broken / review gate)", () => {
    expect(composeRisk(inputs({ policy: { policyDecision: "BLOCK", explicitRuleMatched: false } })).reasons).toEqual([]);
    expect(composeRisk(inputs({ policy: { policyDecision: "REQUIRE_APPROVAL", explicitRuleMatched: true, winningPolicy: { id: "p", name: "n", decision: "REQUIRE_APPROVAL", severity: "HIGH" } } })).reasons).toEqual([]);
  });

  it("an explicit ALLOW does not suppress risk: allowed-by-policy + risky behavior still escalates", () => {
    const core = composeRisk(inputs({ request: sensitive, deviations: [newDestination()] }));
    expect(core.level).toBe("HIGH");
    expect(buildShadow({ level: core.level, actual: "ALLOW", humanApproved: false }).outcome).toBe("WOULD_ESCALATE");
  });

  it("a policy violation corroborates with behavior (policy + behavior → one step up)", () => {
    const core = composeRisk(inputs({ policy: { policyDecision: "ALERT", explicitRuleMatched: true, winningPolicy: { id: "p", name: "n", decision: "ALERT", severity: "MEDIUM" } }, deviations: [newDestination()] }));
    expect(core.level).toBe("HIGH");
  });
});

describe("historical incidents", () => {
  const at = new Date("2026-10-03T00:00:00Z");
  it("one prior incident is LOW; repeated incidents are MEDIUM; truncation is stated", () => {
    const one = composeRisk(inputs({ incidents: [{ type: "approval_request", id: "a1", at, outcome: "REJECTED" }] }));
    expect(one.reasons[0]).toMatchObject({ code: "historical_incident", severity: "LOW" });
    const many = composeRisk(inputs({ incidents: [1, 2, 3].map((n) => ({ type: "policy_evaluation" as const, id: `e${n}`, at, outcome: "ALERT" })), incidentsTruncated: true }));
    expect(many.reasons[0]).toMatchObject({ severity: "MEDIUM" });
    expect(many.reasons[0].summary).toContain("at least 3 times");
    expect(many.reasons[0].evidence.map((e) => e.ref)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("rendering", () => {
  it("formats a numbered, human-readable explanation with the shadow line", () => {
    const core = composeRisk(inputs({ request: sensitive, deviations: [newDestination(), bigVolume()], trust: degraded }));
    const text = formatAssessment(finalizeAssessment(core, buildShadow({ level: core.level, actual: "ALLOW", humanApproved: false })));
    expect(text).toContain("HIGH RISK");
    expect(text).toContain("Reasons:");
    expect(text).toMatch(/1\. .+\n2\. .+\n3\. .+\n4\. /);
    expect(text).toContain("Actual: ALLOW. Aegis risk engine: WOULD REQUIRE APPROVAL.");
  });
});
