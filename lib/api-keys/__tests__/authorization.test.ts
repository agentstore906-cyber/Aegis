import { describe, expect, it } from "vitest";
import type { MemberRole } from "@prisma/client";
import { canManageApiKeys } from "@/lib/api-keys/authorization";

const ALL_ROLES: MemberRole[] = ["OWNER", "ADMIN", "ENGINEER", "SECURITY", "VIEWER"];

describe("canManageApiKeys", () => {
  it("allows OWNER and ADMIN", () => {
    expect(canManageApiKeys("OWNER")).toBe(true);
    expect(canManageApiKeys("ADMIN")).toBe(true);
  });

  it("denies ENGINEER, SECURITY, and VIEWER — narrower than policy/permission management", () => {
    expect(canManageApiKeys("ENGINEER")).toBe(false);
    expect(canManageApiKeys("SECURITY")).toBe(false);
    expect(canManageApiKeys("VIEWER")).toBe(false);
  });

  it("covers every role with a definite answer", () => {
    for (const role of ALL_ROLES) {
      expect(typeof canManageApiKeys(role)).toBe("boolean");
    }
  });
});
