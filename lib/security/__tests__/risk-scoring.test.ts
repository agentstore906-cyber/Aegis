import { describe, expect, it } from "vitest";
import { scoreEventRisk, maxRiskLevel } from "@/lib/security/risk-scoring";

describe("scoreEventRisk", () => {
  it("scores a public data read as LOW", () => {
    const { level } = scoreEventRisk({
      eventType: "DATA_ACCESS",
      action: "docs.read",
      resource: "public_docs",
      status: "SUCCESS",
    });
    expect(level).toBe("LOW");
  });

  it("scores reading customer data as MEDIUM", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "DATA_ACCESS",
      action: "crm.contact.read",
      resource: "customer:acme-inc",
      status: "SUCCESS",
    });
    expect(level).toBe("MEDIUM");
    expect(rule).toBe("read_sensitive_data");
  });

  it("scores modifying customer data as HIGH", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "DATA_ACCESS",
      action: "crm.contact.update",
      resource: "customer:acme-inc",
      status: "SUCCESS",
    });
    expect(level).toBe("HIGH");
    expect(rule).toBe("modify_sensitive_data");
  });

  it("scores deleting data as HIGH even when the resource isn't obviously sensitive", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "ACTION",
      action: "record.delete",
      resource: "widget:123",
      status: "SUCCESS",
    });
    expect(level).toBe("HIGH");
    expect(rule).toBe("delete_data");
  });

  it("scores exporting sensitive data as CRITICAL", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "DATA_ACCESS",
      action: "crm.export",
      resource: "customer_list",
      status: "SUCCESS",
    });
    expect(level).toBe("CRITICAL");
    expect(rule).toBe("export_sensitive_data");
  });

  it("scores a blocked attempt as HIGH regardless of the underlying action", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "ACTION",
      action: "docs.read",
      resource: "public_docs",
      status: "BLOCKED",
    });
    expect(level).toBe("HIGH");
    expect(rule).toBe("unauthorized_attempt");
  });

  it("scores a general write as MEDIUM", () => {
    const { level } = scoreEventRisk({
      eventType: "ACTION",
      action: "task.create",
      resource: "task:456",
      status: "SUCCESS",
    });
    expect(level).toBe("MEDIUM");
  });

  it("defaults to LOW for an unrecognized read-like action", () => {
    const { level, rule } = scoreEventRisk({
      eventType: "SYSTEM",
      action: "health.check",
      status: "SUCCESS",
    });
    expect(level).toBe("LOW");
    expect(rule).toBeNull();
  });

  it("a failed (not blocked) action doesn't get scored up on its own", () => {
    const { level } = scoreEventRisk({
      eventType: "SYSTEM",
      action: "health.check",
      status: "FAILURE",
    });
    expect(level).toBe("LOW");
  });

  it("scores any FINANCIAL event type as at least HIGH", () => {
    const { level } = scoreEventRisk({
      eventType: "FINANCIAL",
      action: "invoice.read",
      status: "SUCCESS",
    });
    expect(level).toBe("HIGH");
  });
});

describe("maxRiskLevel", () => {
  it("returns the higher of the two levels", () => {
    expect(maxRiskLevel("LOW", "HIGH")).toBe("HIGH");
    expect(maxRiskLevel("CRITICAL", "MEDIUM")).toBe("CRITICAL");
    expect(maxRiskLevel("MEDIUM", "MEDIUM")).toBe("MEDIUM");
  });
});
