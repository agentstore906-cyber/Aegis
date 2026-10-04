/** P0 §3/§4 — approval fingerprinting and the pure consumability check. */
import { describe, expect, it } from "vitest";

import {
  checkApprovalConsumable,
  computeRequestFingerprint,
  type ApprovalForConsumption,
} from "@/lib/approvals/binding";

const base = {
  agentId: "agent_1",
  action: "refund.issue",
  resource: "order:42",
  environment: "PRODUCTION",
  tool: "stripe",
  context: { amount: 1500, currency: "usd" },
};

describe("computeRequestFingerprint", () => {
  it("is deterministic and independent of object key order", () => {
    const a = computeRequestFingerprint(base);
    const b = computeRequestFingerprint({ ...base, context: { currency: "usd", amount: 1500 } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when anything that was approved changes", () => {
    const original = computeRequestFingerprint(base);
    expect(computeRequestFingerprint({ ...base, context: { amount: 1501, currency: "usd" } })).not.toBe(original);
    expect(computeRequestFingerprint({ ...base, resource: "order:43" })).not.toBe(original);
    expect(computeRequestFingerprint({ ...base, action: "refund.reverse" })).not.toBe(original);
    expect(computeRequestFingerprint({ ...base, agentId: "agent_2" })).not.toBe(original);
    expect(computeRequestFingerprint({ ...base, environment: "STAGING" })).not.toBe(original);
    expect(computeRequestFingerprint({ ...base, tool: "paypal" })).not.toBe(original);
  });

  it("treats omitted and null fields identically", () => {
    expect(computeRequestFingerprint({ agentId: "a", action: "x" })).toBe(
      computeRequestFingerprint({ agentId: "a", action: "x", resource: null, tool: null, environment: null, context: null })
    );
  });
});

describe("computeRequestFingerprint — P1 telemetry binding", () => {
  it("is unchanged for requests without telemetry (empty telemetry is ignored)", () => {
    expect(computeRequestFingerprint({ ...base, telemetry: {} })).toBe(computeRequestFingerprint(base));
    expect(computeRequestFingerprint({ ...base, telemetry: { dataClasses: [], recordCount: undefined } })).toBe(
      computeRequestFingerprint(base)
    );
  });

  it("binds volume, destination, data classes and end user into what was approved", () => {
    const approved = computeRequestFingerprint({ ...base, telemetry: { recordCount: 10, destination: "a.example.com" } });
    expect(computeRequestFingerprint({ ...base, telemetry: { recordCount: 10_000, destination: "a.example.com" } })).not.toBe(approved);
    expect(computeRequestFingerprint({ ...base, telemetry: { recordCount: 10, destination: "b.example.com" } })).not.toBe(approved);
    expect(computeRequestFingerprint({ ...base, telemetry: { recordCount: 10 } })).not.toBe(approved);
    expect(computeRequestFingerprint({ ...base, telemetry: { recordCount: 10, destination: "a.example.com" } })).toBe(approved);
  });
});

describe("checkApprovalConsumable", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const fingerprint = computeRequestFingerprint(base);
  const approved: ApprovalForConsumption = {
    id: "appr_1",
    agentId: "agent_1",
    status: "APPROVED",
    expiresAt: new Date("2026-10-02T12:00:00Z"),
    requestFingerprint: fingerprint,
    executionExpiresAt: new Date("2026-10-01T12:30:00Z"),
    consumedAt: null,
  };
  const code = (result: ReturnType<typeof checkApprovalConsumable>) =>
    result.ok ? "OK" : result.outcome === "PENDING" ? "PENDING" : result.code;

  it("allows an approved, unused, in-window approval for the exact request", () => {
    expect(code(checkApprovalConsumable(approved, "agent_1", fingerprint, now))).toBe("OK");
  });

  it("refuses replay of an already-consumed approval", () => {
    expect(code(checkApprovalConsumable({ ...approved, consumedAt: now }, "agent_1", fingerprint, now))).toBe(
      "APPROVAL_ALREADY_USED"
    );
  });

  it("refuses using one approval for a different request", () => {
    expect(code(checkApprovalConsumable(approved, "agent_1", "different", now))).toBe("APPROVAL_REQUEST_MISMATCH");
  });

  it("refuses another agent", () => {
    expect(code(checkApprovalConsumable(approved, "agent_2", fingerprint, now))).toBe("APPROVAL_AGENT_MISMATCH");
  });

  it("refuses after the execution window closes", () => {
    expect(
      code(checkApprovalConsumable(approved, "agent_1", fingerprint, new Date("2026-10-01T13:00:00Z")))
    ).toBe("APPROVAL_EXECUTION_WINDOW_EXPIRED");
  });

  it("never lets a pre-P0 (unbound) approval authorize an execution", () => {
    expect(code(checkApprovalConsumable({ ...approved, requestFingerprint: null }, "agent_1", fingerprint, now))).toBe(
      "APPROVAL_LEGACY_UNBOUND"
    );
  });

  it("reports rejected, expired, cancelled and missing approvals", () => {
    expect(code(checkApprovalConsumable({ ...approved, status: "REJECTED" }, "agent_1", fingerprint, now))).toBe("APPROVAL_REJECTED");
    expect(code(checkApprovalConsumable({ ...approved, status: "EXPIRED" }, "agent_1", fingerprint, now))).toBe("APPROVAL_EXPIRED");
    expect(code(checkApprovalConsumable({ ...approved, status: "CANCELLED" }, "agent_1", fingerprint, now))).toBe("APPROVAL_CANCELLED");
    expect(code(checkApprovalConsumable(null, "agent_1", fingerprint, now))).toBe("APPROVAL_NOT_FOUND");
  });

  it("reports a still-pending approval as pending, unless its deadline passed", () => {
    const pending = { ...approved, status: "PENDING" as const, executionExpiresAt: null };
    expect(code(checkApprovalConsumable(pending, "agent_1", fingerprint, now))).toBe("PENDING");
    expect(
      code(checkApprovalConsumable({ ...pending, expiresAt: new Date("2026-10-01T11:00:00Z") }, "agent_1", fingerprint, now))
    ).toBe("APPROVAL_EXPIRED");
  });

  it("checks the request identity before status, so a pending approval for another request isn't 'pending' for this one", () => {
    const pending = { ...approved, status: "PENDING" as const };
    expect(code(checkApprovalConsumable(pending, "agent_1", "different", now))).toBe("APPROVAL_REQUEST_MISMATCH");
  });
});
