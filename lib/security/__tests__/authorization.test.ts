import { describe, expect, it } from "vitest";
import { canResolveSecurityAlerts, canViewSecurityAlerts } from "@/lib/security/authorization";

describe("canViewSecurityAlerts", () => {
  it("is true for VIEWER — security alerts are broadly readable, like Audit", () => {
    expect(canViewSecurityAlerts("VIEWER")).toBe(true);
  });

  it("is false for FINANCE — scoped to costs/audit, not security, by design (lib/rbac/capabilities.ts)", () => {
    expect(canViewSecurityAlerts("FINANCE")).toBe(false);
  });
});

describe("canResolveSecurityAlerts", () => {
  it("allows OWNER, ADMIN, SECURITY", () => {
    expect(canResolveSecurityAlerts("OWNER")).toBe(true);
    expect(canResolveSecurityAlerts("ADMIN")).toBe(true);
    expect(canResolveSecurityAlerts("SECURITY")).toBe(true);
  });

  it("denies ENGINEER, FINANCE, VIEWER", () => {
    expect(canResolveSecurityAlerts("ENGINEER")).toBe(false);
    expect(canResolveSecurityAlerts("FINANCE")).toBe(false);
    expect(canResolveSecurityAlerts("VIEWER")).toBe(false);
  });
});
