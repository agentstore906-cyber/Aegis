import { describe, expect, it } from "vitest";
import { canManageAgentPermissions, canManagePolicies, canViewPolicyEvaluations } from "@/lib/policies/authorization";

describe("canManagePolicies", () => {
  it("allows OWNER, ADMIN, and SECURITY", () => {
    expect(canManagePolicies("OWNER")).toBe(true);
    expect(canManagePolicies("ADMIN")).toBe(true);
    expect(canManagePolicies("SECURITY")).toBe(true);
  });

  it("refuses ENGINEER, FINANCE, and VIEWER — a bug here would let an engineer edit a guardrail meant to stop them", () => {
    expect(canManagePolicies("ENGINEER")).toBe(false);
    expect(canManagePolicies("FINANCE")).toBe(false);
    expect(canManagePolicies("VIEWER")).toBe(false);
  });
});

describe("canManageAgentPermissions", () => {
  it("allows OWNER, ADMIN, SECURITY, and ENGINEER", () => {
    expect(canManageAgentPermissions("OWNER")).toBe(true);
    expect(canManageAgentPermissions("ADMIN")).toBe(true);
    expect(canManageAgentPermissions("SECURITY")).toBe(true);
    expect(canManageAgentPermissions("ENGINEER")).toBe(true);
  });

  it("refuses FINANCE and VIEWER", () => {
    expect(canManageAgentPermissions("FINANCE")).toBe(false);
    expect(canManageAgentPermissions("VIEWER")).toBe(false);
  });
});

describe("canViewPolicyEvaluations", () => {
  it("is unconditionally true — read access to policy evaluation history is not role-gated, including for VIEWER", () => {
    expect(canViewPolicyEvaluations()).toBe(true);
  });
});
