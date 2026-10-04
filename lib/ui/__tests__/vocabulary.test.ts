import { describe, expect, it } from "vitest";
import type { ActivityStatus, AgentStatus, ApprovalStatus, PolicyDecision, RiskLevel, TrustState } from "@prisma/client";

import { AGENT_STATE, APPROVAL, DECISION, FORBIDDEN_CLAIMS, RISK, TRUST, activityPresentation, approvalState, type ApprovalFacts } from "@/lib/ui/vocabulary";

const T0 = new Date("2026-10-10T12:00:00.000Z");
const mins = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("every real value has a presentation (no value can fall through to nothing)", () => {
  it("covers every enum value used by the product", () => {
    const decisions: PolicyDecision[] = ["ALLOW", "ALERT", "REQUIRE_APPROVAL", "BLOCK"];
    const agents: AgentStatus[] = ["ACTIVE", "PAUSED", "STOPPED", "NEEDS_ATTENTION", "ARCHIVED"];
    const trust: TrustState[] = ["TRUSTED", "NORMAL", "DEGRADED", "HIGH_RISK", "RESTRICTED"];
    const risk: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    for (const d of decisions) expect(DECISION[d].label.length).toBeGreaterThan(0);
    for (const a of agents) expect(AGENT_STATE[a].label.length).toBeGreaterThan(0);
    for (const t of trust) expect(TRUST[t].label.length).toBeGreaterThan(0);
    for (const r of risk) expect(RISK[r].label.length).toBeGreaterThan(0);
    for (const s of ["ALLOWED", "BLOCKED", "APPROVAL_REQUIRED", "FAILED", "WARNING"] as ActivityStatus[]) {
      for (const source of ["policy_evaluation", "api", null, undefined]) expect(activityPresentation(s, source).label.length).toBeGreaterThan(0);
    }
  });

  it("never makes a claim of enforcement or prevention that the data model cannot support", () => {
    const everything = [
      ...Object.values(DECISION),
      ...Object.values(AGENT_STATE),
      ...Object.values(TRUST),
      ...Object.values(RISK),
      ...Object.values(APPROVAL),
      ...(["ALLOWED", "BLOCKED", "APPROVAL_REQUIRED", "FAILED", "WARNING"] as ActivityStatus[]).flatMap((s) => [activityPresentation(s, "api"), activityPresentation(s, "policy_evaluation")]),
    ];
    for (const p of everything) {
      for (const forbidden of FORBIDDEN_CLAIMS) {
        expect(`${p.label} ${p.meaning}`, `"${p.label}"`).not.toMatch(forbidden);
      }
    }
  });
});

describe("decisions: what Aegis returned, and what that does not prove", () => {
  it("BLOCK says Aegis denied it and is explicit that prevention depends on the integration", () => {
    expect(DECISION.BLOCK.label).toBe("Blocked");
    expect(DECISION.BLOCK.tone).toBe("blocked");
    expect(DECISION.BLOCK.meaning).toContain("Aegis returned BLOCK");
    expect(DECISION.BLOCK.meaning).toContain("depends on the integration honoring it");
  });

  it("REQUIRE_APPROVAL is 'awaiting approval' — not 'blocked'", () => {
    expect(DECISION.REQUIRE_APPROVAL.label).toBe("Awaiting approval");
    expect(DECISION.REQUIRE_APPROVAL.tone).toBe("approval");
  });

  it("ALERT is allowed-and-flagged, never blocked", () => {
    expect(DECISION.ALERT.label).toBe("Allowed · flagged");
    expect(DECISION.ALERT.tone).toBe("warning");
  });
});

describe("activity rows: the word depends on who produced the row", () => {
  it("an agent-REPORTED success is 'Recorded' — Aegis did not allow anything", () => {
    expect(activityPresentation("ALLOWED", "api")).toMatchObject({ label: "Recorded", tone: "neutral" });
    expect(activityPresentation("WARNING", "api").label).toBe("Recorded · flagged");
  });

  it("an agent-REPORTED 'blocked' is the agent's own guardrail, not an Aegis decision", () => {
    expect(activityPresentation("BLOCKED", "api")).toMatchObject({ label: "Reported blocked", tone: "neutral" });
    expect(activityPresentation("BLOCKED", "api").meaning).toContain("did not decide");
  });

  it("an Aegis decision row uses the decision vocabulary", () => {
    expect(activityPresentation("ALLOWED", "policy_evaluation").label).toBe("Allowed");
    expect(activityPresentation("BLOCKED", "policy_evaluation").label).toBe("Blocked");
    expect(activityPresentation("WARNING", "policy_evaluation").label).toBe("Allowed · flagged");
    expect(activityPresentation("APPROVAL_REQUIRED", "policy_evaluation").label).toBe("Awaiting approval");
  });

  it("with an unknown source it never claims an Aegis decision for a success", () => {
    expect(activityPresentation("ALLOWED", undefined).label).toBe("Recorded");
    expect(activityPresentation("BLOCKED", null).label).toBe("Reported blocked");
  });
});

describe("approvals: derived from the same facts the backend uses to allow consumption", () => {
  const base = (over: Partial<ApprovalFacts>): ApprovalFacts => ({ status: "PENDING", expiresAt: mins(60), executionExpiresAt: null, consumedAt: null, ...over });
  const state = (over: Partial<ApprovalFacts>) => approvalState(base(over), T0);

  it("pending and in time is awaiting; pending past its deadline is expired even if the stored status lags", () => {
    expect(state({})).toBe("AWAITING");
    expect(state({ expiresAt: mins(-1) })).toBe("EXPIRED");
    expect(state({ expiresAt: T0 })).toBe("EXPIRED"); // the deadline instant itself is already too late
    expect(state({ expiresAt: null })).toBe("AWAITING");
  });

  it("approved is usable ONCE until its execution window closes", () => {
    expect(state({ status: "APPROVED", executionExpiresAt: mins(30) })).toBe("USABLE");
    expect(state({ status: "APPROVED", executionExpiresAt: null })).toBe("USABLE");
  });

  it("an approved approval is never presented as usable once consumed or once its window has closed", () => {
    expect(state({ status: "APPROVED", executionExpiresAt: mins(30), consumedAt: mins(-5) })).toBe("CONSUMED");
    expect(state({ status: "APPROVED", executionExpiresAt: mins(-1) })).toBe("EXPIRED_UNUSED");
    expect(state({ status: "APPROVED", executionExpiresAt: mins(-1), consumedAt: mins(-30) })).toBe("CONSUMED"); // consumed wins: it WAS used
  });

  it("terminal states stay terminal", () => {
    for (const status of ["REJECTED", "CANCELLED", "EXPIRED"] as ApprovalStatus[]) {
      expect(state({ status, consumedAt: null })).toBe(status);
    }
  });

  it("only USABLE is presented with the success tone", () => {
    const tones = Object.entries(APPROVAL).filter(([, p]) => p.tone === "safe").map(([k]) => k);
    expect(tones).toEqual(["USABLE"]);
  });
});

describe("state color is reserved for state", () => {
  it("risk and decision tones follow the documented scale", () => {
    expect(RISK.LOW.tone).toBe("neutral");
    expect(RISK.MEDIUM.tone).toBe("warning");
    expect(RISK.HIGH.tone).toBe("risk");
    expect(RISK.CRITICAL.tone).toBe("blocked");
    expect(AGENT_STATE.ACTIVE.tone).toBe("safe");
    expect(AGENT_STATE.STOPPED.tone).toBe("blocked");
    expect(TRUST.TRUSTED.tone).toBe("safe");
  });
});
