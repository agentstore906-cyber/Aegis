import { describe, expect, it } from "vitest";
import {
  detectBlockSpike,
  detectCostSpike,
  detectFailureLoop,
  detectHighRiskBurst,
  detectNewSensitiveAction,
  detectNewToolUsage,
} from "@/lib/security/detectors";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";

describe("detectNewSensitiveAction", () => {
  it("returns null when the agent has used this action before", () => {
    const finding = detectNewSensitiveAction({
      agentId: "a1",
      agentName: "Finance Agent",
      action: "refund.issue",
      riskLevel: "HIGH",
      status: "ALLOWED",
      traceId: null,
      hasPriorHistory: true,
    });
    expect(finding).toBeNull();
  });

  it("returns null for a new LOW-risk action — only HIGH/CRITICAL risk triggers this detector", () => {
    const finding = detectNewSensitiveAction({
      agentId: "a1",
      agentName: "Finance Agent",
      action: "invoice.read",
      riskLevel: "LOW",
      status: "ALLOWED",
      traceId: null,
      hasPriorHistory: false,
    });
    expect(finding).toBeNull();
  });

  it("fires HIGH for a new HIGH-risk action that was allowed", () => {
    const finding = detectNewSensitiveAction({
      agentId: "a1",
      agentName: "Finance Agent",
      action: "refund.issue",
      riskLevel: "HIGH",
      status: "ALLOWED",
      traceId: "trace_1",
      hasPriorHistory: false,
    });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.NEW_SENSITIVE_ACTION);
    expect(finding?.severity).toBe("HIGH");
  });

  it("fires CRITICAL for a new action that was blocked (e.g. a first bank_account.change attempt)", () => {
    const finding = detectNewSensitiveAction({
      agentId: "a1",
      agentName: "Finance Agent",
      action: "bank_account.change",
      riskLevel: "HIGH",
      status: "BLOCKED",
      traceId: null,
      hasPriorHistory: false,
    });
    expect(finding?.severity).toBe("CRITICAL");
  });

  it("fires CRITICAL for a new CRITICAL-risk action even if allowed", () => {
    const finding = detectNewSensitiveAction({
      agentId: "a1",
      agentName: "Deployment Agent",
      action: "deployment.execute",
      riskLevel: "CRITICAL",
      status: "ALLOWED",
      traceId: null,
      hasPriorHistory: false,
    });
    expect(finding?.severity).toBe("CRITICAL");
  });
});

describe("detectBlockSpike", () => {
  it("returns null at or below the threshold", () => {
    expect(detectBlockSpike({ agentId: "a1", agentName: "Agent", blockedCountInWindow: 5 })).toBeNull();
  });

  it("fires HIGH once over the threshold", () => {
    const finding = detectBlockSpike({ agentId: "a1", agentName: "Agent", blockedCountInWindow: 6 });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.BLOCK_SPIKE);
    expect(finding?.severity).toBe("HIGH");
  });

  it("respects a custom threshold", () => {
    expect(detectBlockSpike({ agentId: "a1", agentName: "Agent", blockedCountInWindow: 2, threshold: 1 })).not.toBeNull();
  });
});

describe("detectFailureLoop", () => {
  it("returns null below the threshold", () => {
    expect(
      detectFailureLoop({ agentId: "a1", agentName: "Agent", action: "send_email", failureCountInWindow: 2 })
    ).toBeNull();
  });

  it("fires MEDIUM at the threshold", () => {
    const finding = detectFailureLoop({ agentId: "a1", agentName: "Agent", action: "send_email", failureCountInWindow: 3 });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.FAILURE_LOOP);
    expect(finding?.severity).toBe("MEDIUM");
  });
});

describe("detectNewToolUsage", () => {
  it("returns null when the namespace has been used before", () => {
    expect(
      detectNewToolUsage({ agentId: "a1", agentName: "Agent", action: "crm.export", hasPriorNamespaceHistory: true })
    ).toBeNull();
  });

  it("fires LOW for a brand-new namespace", () => {
    const finding = detectNewToolUsage({ agentId: "a1", agentName: "Agent", action: "crm.export", hasPriorNamespaceHistory: false });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.NEW_TOOL_USAGE);
    expect(finding?.severity).toBe("LOW");
  });

  it("handles an action with no dot namespace gracefully", () => {
    const finding = detectNewToolUsage({
      agentId: "a1",
      agentName: "Agent",
      action: "read_crm_contact",
      hasPriorNamespaceHistory: false,
    });
    expect(finding).not.toBeNull();
    expect(finding?.evidence.namespace).toBe("read_crm_contact");
  });
});

describe("detectHighRiskBurst", () => {
  it("returns null below the threshold", () => {
    expect(detectHighRiskBurst({ agentId: "a1", agentName: "Agent", highRiskCountInWindow: 2 })).toBeNull();
  });

  it("fires HIGH at the threshold", () => {
    const finding = detectHighRiskBurst({ agentId: "a1", agentName: "Agent", highRiskCountInWindow: 3 });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.HIGH_RISK_BURST);
    expect(finding?.severity).toBe("HIGH");
  });
});

describe("detectCostSpike", () => {
  it("returns null with no baseline (new or previously idle agent)", () => {
    const finding = detectCostSpike({
      agentId: "a1",
      agentName: "Research Agent",
      todaySpendCents: 9400,
      trailingDailyAverageCents: 0,
    });
    expect(finding).toBeNull();
  });

  it("returns null when today's spend is trivial, even if technically a multiple of a tiny baseline", () => {
    const finding = detectCostSpike({
      agentId: "a1",
      agentName: "Research Agent",
      todaySpendCents: 10,
      trailingDailyAverageCents: 1,
    });
    expect(finding).toBeNull();
  });

  it("returns null when today's spend is under the multiplier", () => {
    const finding = detectCostSpike({
      agentId: "a1",
      agentName: "Research Agent",
      todaySpendCents: 2000,
      trailingDailyAverageCents: 1200,
    });
    expect(finding).toBeNull();
  });

  it("fires HIGH when today's spend is a large multiple of the baseline, using 'likely contributor' wording", () => {
    const finding = detectCostSpike({
      agentId: "a1",
      agentName: "Research Agent",
      todaySpendCents: 9400,
      trailingDailyAverageCents: 1200,
    });
    expect(finding?.type).toBe(SECURITY_ALERT_TYPES.COST_SPIKE);
    expect(finding?.severity).toBe("HIGH");
    expect(finding?.description).toMatch(/likely contributor/i);
    expect(finding?.description).not.toMatch(/\bcaused by\b/i);
  });
});
