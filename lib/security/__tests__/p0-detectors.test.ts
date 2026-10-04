/** P0 §1/§5 — kill-switch truthfulness detector and dedupe keys. */
import { describe, expect, it } from "vitest";

import {
  detectActivityWhileHalted,
  detectFailureLoop,
  detectNewSensitiveAction,
  detectNewToolUsage,
} from "@/lib/security/detectors";

const agent = { agentId: "agent_1", agentName: "Billing Agent" };

describe("detectActivityWhileHalted", () => {
  it("flags a completed action reported by a STOPPED agent as detection, never as blocked", () => {
    const finding = detectActivityWhileHalted({ ...agent, agentStatus: "STOPPED", action: "refund.issue", status: "ALLOWED" });
    expect(finding?.type).toBe("ACTIVITY_WHILE_HALTED");
    expect(finding?.severity).toBe("CRITICAL");
    expect(finding?.description).toMatch(/could not prevent it/);
    expect(finding?.description).not.toMatch(/\bwas blocked\b/);
  });

  it("is HIGH for PAUSED", () => {
    expect(detectActivityWhileHalted({ ...agent, agentStatus: "PAUSED", action: "x", status: "WARNING" })?.severity).toBe("HIGH");
  });

  it("ignores self-reported BLOCKED/FAILED actions and running agents", () => {
    expect(detectActivityWhileHalted({ ...agent, agentStatus: "STOPPED", action: "x", status: "BLOCKED" })).toBeNull();
    expect(detectActivityWhileHalted({ ...agent, agentStatus: "STOPPED", action: "x", status: "FAILED" })).toBeNull();
    expect(detectActivityWhileHalted({ ...agent, agentStatus: "ACTIVE", action: "x", status: "ALLOWED" })).toBeNull();
    expect(detectActivityWhileHalted({ ...agent, agentStatus: "NEEDS_ATTENTION", action: "x", status: "ALLOWED" })).toBeNull();
  });
});

describe("dedupe keys keep genuinely different findings apart", () => {
  it("per-action / per-tool detectors carry distinct keys", () => {
    const a = detectNewSensitiveAction({ ...agent, action: "crm.export", riskLevel: "HIGH", status: "ALLOWED", traceId: null, hasPriorHistory: false });
    const b = detectNewSensitiveAction({ ...agent, action: "crm.delete", riskLevel: "HIGH", status: "ALLOWED", traceId: null, hasPriorHistory: false });
    expect(a?.dedupeKey).toBe("action:crm.export");
    expect(b?.dedupeKey).toBe("action:crm.delete");
    expect(detectNewToolUsage({ ...agent, action: "x.y", toolName: "stripe", hasPriorNamespaceHistory: true, hasPriorToolHistory: false })?.dedupeKey).toBe("tool:stripe");
    expect(detectFailureLoop({ ...agent, action: "sync.run", failureCountInWindow: 5 })?.dedupeKey).toBe("action:sync.run");
  });
});
