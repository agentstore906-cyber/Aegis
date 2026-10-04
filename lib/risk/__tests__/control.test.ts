import { describe, expect, it } from "vitest";
import type { PolicyDecision, RiskLevel } from "@prisma/client";

import {
  DEFAULT_RISK_CONTROL,
  controlOutcome,
  isRiskControlGloballyDisabled,
  planRiskControl,
  riskDecisionFor,
  riskGateReason,
  validateRiskControlConfig,
  type RiskControlConfig,
} from "@/lib/risk/control";
import { buildShadow } from "@/lib/risk/compose";
import { buildControlRecord } from "@/lib/risk/record";

const config = (over: Partial<RiskControlConfig> = {}): RiskControlConfig => ({ ...DEFAULT_RISK_CONTROL, ...over });
const plan = (c: RiskControlConfig, level: RiskLevel | null, policyDecision: PolicyDecision, globallyDisabled = false) =>
  planRiskControl({ config: c, globallyDisabled, level, policyDecision });

describe("defaults never change behavior", () => {
  it("a default organization is OBSERVE with the P4 mapping", () => {
    expect(DEFAULT_RISK_CONTROL).toEqual({ mode: "OBSERVE", mediumAction: "ALERT", highAction: "REQUIRE_APPROVAL" });
  });

  it.each(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as RiskLevel[])("OBSERVE never changes the policy decision (level %s)", (level) => {
    for (const policy of ["ALLOW", "ALERT", "REQUIRE_APPROVAL", "BLOCK"] as PolicyDecision[]) {
      const p = plan(config({ highAction: "BLOCK" }), level, policy);
      expect(p.gate).toBe(policy);
      expect(p.escalated).toBe(false);
      expect(p.effectiveMode).toBe("OBSERVE");
    }
  });
});

describe("level → decision mapping", () => {
  it("LOW allows, MEDIUM is configurable, HIGH and CRITICAL share the high action", () => {
    const c = config({ mediumAction: "REQUIRE_APPROVAL", highAction: "BLOCK" });
    expect(riskDecisionFor("LOW", c)).toBe("ALLOW");
    expect(riskDecisionFor("MEDIUM", c)).toBe("REQUIRE_APPROVAL");
    expect(riskDecisionFor("HIGH", c)).toBe("BLOCK");
    expect(riskDecisionFor("CRITICAL", c)).toBe("BLOCK");
  });
});

describe("modes", () => {
  it("APPROVAL_REQUIRED caps BLOCK at REQUIRE_APPROVAL but still reports what ENFORCE would do", () => {
    const p = plan(config({ mode: "APPROVAL_REQUIRED", highAction: "BLOCK" }), "HIGH", "ALLOW");
    expect(p.riskDecision).toBe("BLOCK");
    expect(p.enforceable).toBe("REQUIRE_APPROVAL");
    expect(p.cappedByMode).toBe(true);
    expect(p.gate).toBe("REQUIRE_APPROVAL");
  });

  it("ENFORCE applies the configured action, including BLOCK", () => {
    expect(plan(config({ mode: "ENFORCE", highAction: "BLOCK" }), "HIGH", "ALLOW").gate).toBe("BLOCK");
    expect(plan(config({ mode: "ENFORCE" }), "HIGH", "ALLOW").gate).toBe("REQUIRE_APPROVAL");
    expect(plan(config({ mode: "ENFORCE", mediumAction: "ALERT" }), "MEDIUM", "ALLOW").gate).toBe("ALERT");
    expect(plan(config({ mode: "ENFORCE", mediumAction: "ALLOW" }), "MEDIUM", "ALLOW")).toMatchObject({ gate: "ALLOW", escalated: false });
  });

  it("LOW risk adds nothing in any mode", () => {
    for (const mode of ["OBSERVE", "APPROVAL_REQUIRED", "ENFORCE"] as const) {
      expect(plan(config({ mode }), "LOW", "ALLOW")).toMatchObject({ gate: "ALLOW", escalated: false });
    }
  });
});

describe("policy precedence: risk only ever adds caution", () => {
  const decisions: PolicyDecision[] = ["ALLOW", "ALERT", "REQUIRE_APPROVAL", "BLOCK"];
  const order = { ALLOW: 0, ALERT: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 } as const;

  it("the gate is never weaker than policy, for every mode, level, mapping and policy decision", () => {
    for (const mode of ["OBSERVE", "APPROVAL_REQUIRED", "ENFORCE"] as const)
      for (const level of ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as RiskLevel[])
        for (const mediumAction of ["ALLOW", "ALERT", "REQUIRE_APPROVAL"] as const)
          for (const highAction of ["REQUIRE_APPROVAL", "BLOCK"] as const)
            for (const policy of decisions) {
              const p = plan({ mode, mediumAction, highAction }, level, policy);
              expect(order[p.gate]).toBeGreaterThanOrEqual(order[policy]);
            }
  });

  it("an explicit BLOCK stays BLOCK and is not 'escalated' by risk", () => {
    const p = plan(config({ mode: "ENFORCE", highAction: "BLOCK" }), "CRITICAL", "BLOCK");
    expect(p).toMatchObject({ gate: "BLOCK", escalated: false });
  });

  it("a stricter policy decision beats a more lenient risk mapping", () => {
    expect(plan(config({ mode: "ENFORCE" }), "MEDIUM", "REQUIRE_APPROVAL").gate).toBe("REQUIRE_APPROVAL");
    expect(plan(config({ mode: "ENFORCE", mediumAction: "ALLOW" }), "MEDIUM", "ALERT").gate).toBe("ALERT");
  });
});

describe("emergency controls", () => {
  it("a global disable turns an ENFORCE organization into OBSERVE and records both modes", () => {
    const p = plan(config({ mode: "ENFORCE", highAction: "BLOCK" }), "CRITICAL", "ALLOW", true);
    expect(p).toMatchObject({ configuredMode: "ENFORCE", effectiveMode: "OBSERVE", globallyDisabled: true, gate: "ALLOW", escalated: false });
    // The shadow comparison still has the configured mapping to compare against.
    expect(p.riskDecision).toBe("BLOCK");
  });

  it.each([
    ["1", true],
    ["true", true],
    ["YES", true],
    ["0", false],
    ["", false],
    [undefined, false],
  ])("AEGIS_RISK_CONTROL_DISABLED=%s → %s", (value, expected) => {
    expect(isRiskControlGloballyDisabled({ AEGIS_RISK_CONTROL_DISABLED: value })).toBe(expected);
  });
});

describe("no assessment", () => {
  it("OBSERVE without an assessment is simply observed", () => {
    const p = plan(config(), null, "ALLOW");
    expect(p.unavailable).toBe(false);
    expect(controlOutcome({ plan: p, halted: false, finalDecision: "ALLOW", finalSource: "POLICY" })).toBe("OBSERVED");
  });

  it("an enforcing mode without an assessment does not gate and is recorded as UNAVAILABLE (fail-open to policy)", () => {
    const p = plan(config({ mode: "ENFORCE", highAction: "BLOCK" }), null, "ALLOW");
    expect(p).toMatchObject({ unavailable: true, gate: "ALLOW", escalated: false });
    expect(controlOutcome({ plan: p, halted: false, finalDecision: "ALLOW", finalSource: "POLICY" })).toBe("UNAVAILABLE");
  });
});

describe("outcome labels", () => {
  const enforce = plan(config({ mode: "ENFORCE" }), "HIGH", "ALLOW");
  it("ESCALATED when risk made it stricter, even if an approval is still pending or was invalid", () => {
    expect(controlOutcome({ plan: enforce, halted: false, finalDecision: "REQUIRE_APPROVAL", finalSource: "RISK" })).toBe("ESCALATED");
    expect(controlOutcome({ plan: enforce, halted: false, finalDecision: "BLOCK", finalSource: "APPROVAL" })).toBe("ESCALATED");
  });
  it("APPROVAL_HONORED only when a consumed approval turned the gate into ALLOW", () => {
    expect(controlOutcome({ plan: enforce, halted: false, finalDecision: "ALLOW", finalSource: "APPROVAL" })).toBe("APPROVAL_HONORED");
  });
  it("the kill switch wins over everything", () => {
    expect(controlOutcome({ plan: enforce, halted: true, finalDecision: "BLOCK", finalSource: "CONTROL" })).toBe("KILL_SWITCH");
  });
  it("NO_CHANGE when risk had nothing to add", () => {
    const low = plan(config({ mode: "ENFORCE" }), "LOW", "ALLOW");
    expect(controlOutcome({ plan: low, halted: false, finalDecision: "ALLOW", finalSource: "POLICY" })).toBe("NO_CHANGE");
  });
});

describe("configuration validation", () => {
  it("accepts sensible mappings", () => {
    expect(validateRiskControlConfig(config())).toBeNull();
    expect(validateRiskControlConfig(config({ mediumAction: "REQUIRE_APPROVAL", highAction: "BLOCK" }))).toBeNull();
  });
  it("rejects BLOCK for medium, ALLOW/ALERT for high", () => {
    expect(validateRiskControlConfig(config({ mediumAction: "BLOCK" }))).toMatch(/Medium/);
    expect(validateRiskControlConfig(config({ highAction: "ALLOW" }))).toMatch(/High/);
    expect(validateRiskControlConfig(config({ highAction: "ALERT" }))).toMatch(/High/);
  });
});

describe("agent-facing reason", () => {
  it("names the level, mode and policy outcome but never an individual signal", () => {
    const p = plan(config({ mode: "ENFORCE", highAction: "BLOCK" }), "HIGH", "ALLOW");
    const reason = riskGateReason({ plan: p, level: "HIGH", policyDecision: "ALLOW", policyReason: "Allowed by permission crm.export." });
    expect(reason).toContain("Blocked by Aegis risk control");
    expect(reason).toContain("HIGH risk");
    expect(reason).toContain("Allowed by permission crm.export.");
    expect(reason).not.toMatch(/destination|volume|trust/i);
  });
});

describe("shadow recommendation uses the configured mapping", () => {
  it("OBSERVE with highAction=BLOCK: Actual ALLOW, Recommended BLOCK", () => {
    const p = plan(config({ highAction: "BLOCK" }), "HIGH", "ALLOW");
    const shadow = buildShadow({ level: "HIGH", actual: "ALLOW", humanApproved: false, riskDecision: p.riskDecision ?? undefined });
    expect(shadow).toMatchObject({ actual: "ALLOW", recommended: "BLOCK", outcome: "WOULD_ESCALATE", summary: "Actual: ALLOW. Aegis risk engine: WOULD BLOCK." });
  });
});

describe("control record", () => {
  it("carries decision, policy, mode, level, signals, trust, timestamp and trace without an assessment too", () => {
    const p = plan(config({ mode: "ENFORCE" }), null, "ALLOW");
    const record = buildControlRecord({
      plan: p,
      config: config({ mode: "ENFORCE" }),
      outcome: "UNAVAILABLE",
      policyDecision: "ALLOW",
      finalDecision: "ALLOW",
      finalSource: "POLICY",
      assessment: null,
      decidedAt: new Date("2026-10-06T10:00:00.000Z"),
      traceId: "trace_1",
    });
    expect(record).toMatchObject({
      version: 1,
      configuredMode: "ENFORCE",
      effectiveMode: "ENFORCE",
      outcome: "UNAVAILABLE",
      policyDecision: "ALLOW",
      riskLevel: null,
      finalDecision: "ALLOW",
      finalSource: "POLICY",
      trust: null,
      signals: [],
      decidedAt: "2026-10-06T10:00:00.000Z",
      traceId: "trace_1",
    });
  });
});
