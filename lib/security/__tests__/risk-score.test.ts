import { describe, expect, it } from "vitest";
import { computeAgentRiskScore, type RiskScoreSignals } from "@/lib/security/risk-score";

function baseSignals(overrides: Partial<RiskScoreSignals> = {}): RiskScoreSignals {
  return {
    agentRiskLevel: "LOW",
    openCriticalAlerts: 0,
    openHighAlerts: 0,
    openMediumAlerts: 0,
    hasNewCapabilityAlert: false,
    blockedActions7d: 0,
    policyViolations7d: 0,
    failedActions7d: 0,
    destructiveActions7d: 0,
    ...overrides,
  };
}

describe("computeAgentRiskScore — clean agent", () => {
  it("scores 0 with no factors for a LOW-risk agent with a totally clean 7 days", () => {
    const result = computeAgentRiskScore(baseSignals());
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });
});

describe("computeAgentRiskScore — false-positive edge cases", () => {
  it("a single isolated blocked action barely moves the score, never spikes it", () => {
    const result = computeAgentRiskScore(baseSignals({ blockedActions7d: 1 }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(20);
  });

  it("a single failed action contributes less than a single blocked action", () => {
    const blocked = computeAgentRiskScore(baseSignals({ blockedActions7d: 1 }));
    const failed = computeAgentRiskScore(baseSignals({ failedActions7d: 1 }));
    expect(failed.score).toBeLessThan(blocked.score);
  });

  it("gaining a new capability alone contributes only a small amount, not a red flag by itself", () => {
    const result = computeAgentRiskScore(baseSignals({ hasNewCapabilityAlert: true }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("a MEDIUM-risk classification alone stays a modest score, not treated as already dangerous", () => {
    const result = computeAgentRiskScore(baseSignals({ agentRiskLevel: "MEDIUM" }));
    expect(result.score).toBeLessThan(25);
  });
});

describe("computeAgentRiskScore — escalation", () => {
  it("increases monotonically as blocked actions increase", () => {
    const low = computeAgentRiskScore(baseSignals({ blockedActions7d: 1 }));
    const mid = computeAgentRiskScore(baseSignals({ blockedActions7d: 4 }));
    const high = computeAgentRiskScore(baseSignals({ blockedActions7d: 10 }));
    expect(mid.score).toBeGreaterThanOrEqual(low.score);
    expect(high.score).toBeGreaterThan(mid.score);
  });

  it("a CRITICAL-risk agent with open critical alerts and repeated policy violations scores high", () => {
    const result = computeAgentRiskScore(
      baseSignals({
        agentRiskLevel: "CRITICAL",
        openCriticalAlerts: 2,
        policyViolations7d: 6,
        destructiveActions7d: 4,
      })
    );
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("never exceeds 100 no matter how many factors stack", () => {
    const result = computeAgentRiskScore(
      baseSignals({
        agentRiskLevel: "CRITICAL",
        openCriticalAlerts: 20,
        openHighAlerts: 20,
        openMediumAlerts: 20,
        hasNewCapabilityAlert: true,
        blockedActions7d: 100,
        policyViolations7d: 100,
        failedActions7d: 100,
        destructiveActions7d: 100,
      })
    );
    expect(result.score).toBe(100);
  });
});

describe("computeAgentRiskScore — explainability", () => {
  it("every factor that contributes points is named in the reasons list", () => {
    const result = computeAgentRiskScore(
      baseSignals({ agentRiskLevel: "HIGH", openCriticalAlerts: 1, destructiveActions7d: 3 })
    );
    expect(result.factors.length).toBeGreaterThanOrEqual(3);
    for (const factor of result.factors) {
      expect(factor.points).toBeGreaterThan(0);
      expect(factor.label.length).toBeGreaterThan(0);
    }
  });

  it("factors are sorted by contribution, most impactful first", () => {
    const result = computeAgentRiskScore(
      baseSignals({ agentRiskLevel: "CRITICAL", blockedActions7d: 1 })
    );
    expect(result.factors[0].points).toBeGreaterThanOrEqual(result.factors[result.factors.length - 1].points);
  });

  it("never fabricates a reason for a factor that contributed nothing", () => {
    const result = computeAgentRiskScore(baseSignals({ blockedActions7d: 0, policyViolations7d: 0 }));
    expect(result.factors.some((f) => f.label.includes("blocked"))).toBe(false);
    expect(result.factors.some((f) => f.label.includes("denied by policy"))).toBe(false);
  });
});
