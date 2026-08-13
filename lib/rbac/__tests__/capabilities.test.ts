import { describe, expect, it } from "vitest";
import type { MemberRole } from "@prisma/client";
import { CAPABILITIES, capabilitiesFor, hasCapability } from "@/lib/rbac/capabilities";

const ALL_ROLES: MemberRole[] = ["OWNER", "ADMIN", "ENGINEER", "SECURITY", "FINANCE", "VIEWER"];

describe("hasCapability", () => {
  it("gives OWNER every capability", () => {
    for (const capability of CAPABILITIES) {
      expect(hasCapability("OWNER", capability)).toBe(true);
    }
  });

  it("gives ADMIN every capability", () => {
    for (const capability of CAPABILITIES) {
      expect(hasCapability("ADMIN", capability)).toBe(true);
    }
  });

  it("VIEWER cannot manage API keys", () => {
    expect(hasCapability("VIEWER", "manage_api_keys")).toBe(false);
  });

  it("VIEWER cannot manage anything", () => {
    for (const capability of CAPABILITIES) {
      if (capability.startsWith("view_")) continue;
      expect(hasCapability("VIEWER", capability)).toBe(false);
    }
  });

  it("FINANCE can view costs but not manage policies", () => {
    expect(hasCapability("FINANCE", "view_costs")).toBe(true);
    expect(hasCapability("FINANCE", "manage_policies")).toBe(false);
    expect(hasCapability("FINANCE", "manage_agents")).toBe(false);
  });

  it("SECURITY can view and resolve security alerts, and resolve approvals", () => {
    expect(hasCapability("SECURITY", "view_security")).toBe(true);
    expect(hasCapability("SECURITY", "resolve_security")).toBe(true);
    expect(hasCapability("SECURITY", "resolve_approvals")).toBe(true);
  });

  it("SECURITY can manage agents so 'Pause agent' from an alert works", () => {
    expect(hasCapability("SECURITY", "manage_agents")).toBe(true);
  });

  it("ENGINEER can manage agents and permissions but not policies or approvals", () => {
    expect(hasCapability("ENGINEER", "manage_agents")).toBe(true);
    expect(hasCapability("ENGINEER", "manage_permissions")).toBe(true);
    expect(hasCapability("ENGINEER", "manage_policies")).toBe(false);
    expect(hasCapability("ENGINEER", "resolve_approvals")).toBe(false);
  });

  it("only OWNER and ADMIN can manage members, API keys, and webhooks", () => {
    for (const capability of ["manage_members", "manage_api_keys", "manage_webhooks"] as const) {
      expect(hasCapability("OWNER", capability)).toBe(true);
      expect(hasCapability("ADMIN", capability)).toBe(true);
      expect(hasCapability("ENGINEER", capability)).toBe(false);
      expect(hasCapability("SECURITY", capability)).toBe(false);
      expect(hasCapability("FINANCE", capability)).toBe(false);
      expect(hasCapability("VIEWER", capability)).toBe(false);
    }
  });

  it("FINANCE can view billing but not manage it", () => {
    expect(hasCapability("FINANCE", "view_billing")).toBe(true);
    expect(hasCapability("FINANCE", "manage_billing")).toBe(false);
  });

  it("only OWNER and ADMIN can manage billing", () => {
    expect(hasCapability("OWNER", "manage_billing")).toBe(true);
    expect(hasCapability("ADMIN", "manage_billing")).toBe(true);
    expect(hasCapability("ENGINEER", "manage_billing")).toBe(false);
    expect(hasCapability("SECURITY", "manage_billing")).toBe(false);
    expect(hasCapability("FINANCE", "manage_billing")).toBe(false);
    expect(hasCapability("VIEWER", "manage_billing")).toBe(false);
  });

  it("every role has a defined capability list covering every role", () => {
    for (const role of ALL_ROLES) {
      expect(Array.isArray(capabilitiesFor(role))).toBe(true);
    }
  });
});
