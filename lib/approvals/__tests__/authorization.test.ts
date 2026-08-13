import { describe, expect, it } from "vitest";
import type { MemberRole } from "@prisma/client";
import { canResolveApproval, canViewApprovals } from "@/lib/approvals/authorization";

const ALL_ROLES: MemberRole[] = ["OWNER", "ADMIN", "ENGINEER", "SECURITY", "VIEWER"];

describe("canResolveApproval", () => {
  it("allows OWNER, ADMIN, and SECURITY", () => {
    expect(canResolveApproval("OWNER")).toBe(true);
    expect(canResolveApproval("ADMIN")).toBe(true);
    expect(canResolveApproval("SECURITY")).toBe(true);
  });

  it("denies ENGINEER and VIEWER", () => {
    expect(canResolveApproval("ENGINEER")).toBe(false);
    expect(canResolveApproval("VIEWER")).toBe(false);
  });

  it("covers every role with a definite answer", () => {
    for (const role of ALL_ROLES) {
      expect(typeof canResolveApproval(role)).toBe("boolean");
    }
  });
});

describe("canViewApprovals", () => {
  it("is always true — every member, including VIEWER, can read approval history", () => {
    expect(canViewApprovals()).toBe(true);
  });
});
