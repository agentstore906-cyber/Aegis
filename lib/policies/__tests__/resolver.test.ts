import { describe, expect, it } from "vitest";
import { resolveDecision } from "@/lib/policies/resolver";
import { makeInput, makePermission, makePolicy } from "@/lib/policies/__tests__/fixtures";

describe("resolveDecision", () => {
  it("defaults to BLOCK when nothing matches", () => {
    const result = resolveDecision(undefined, [], makeInput());
    expect(result.decision).toBe("BLOCK");
    expect(result.reason).toMatch(/blocked by default/i);
  });

  it("returns ALLOW when only the baseline permission matches", () => {
    const permission = makePermission({ decision: "ALLOW" });
    const result = resolveDecision(permission, [], makeInput());
    expect(result.decision).toBe("ALLOW");
  });

  it("returns REQUIRE_APPROVAL when only the baseline permission matches", () => {
    const permission = makePermission({ decision: "REQUIRE_APPROVAL" });
    const result = resolveDecision(permission, [], makeInput());
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("returns BLOCK when only the baseline permission matches", () => {
    const permission = makePermission({ decision: "BLOCK" });
    const result = resolveDecision(permission, [], makeInput());
    expect(result.decision).toBe("BLOCK");
  });

  it("BLOCK overrides ALLOW", () => {
    const permission = makePermission({ decision: "ALLOW" });
    const blockPolicy = makePolicy({ decision: "BLOCK", name: "Block it" });
    const result = resolveDecision(permission, [blockPolicy], makeInput());
    expect(result.decision).toBe("BLOCK");
    expect(result.reason).toContain("Block it");
  });

  it("BLOCK overrides REQUIRE_APPROVAL", () => {
    const permission = makePermission({ decision: "REQUIRE_APPROVAL" });
    const blockPolicy = makePolicy({ decision: "BLOCK", name: "Block it" });
    const result = resolveDecision(permission, [blockPolicy], makeInput());
    expect(result.decision).toBe("BLOCK");
  });

  it("REQUIRE_APPROVAL overrides ALLOW", () => {
    const permission = makePermission({ decision: "ALLOW" });
    const approvalPolicy = makePolicy({ decision: "REQUIRE_APPROVAL", name: "Needs approval" });
    const result = resolveDecision(permission, [approvalPolicy], makeInput());
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.reason).toContain("Needs approval");
  });

  it("records every matched policy, not just the winner (conflicts are never hidden)", () => {
    const allowPolicy = makePolicy({ decision: "ALLOW", name: "Allow policy", priority: 50 });
    const blockPolicy = makePolicy({ decision: "BLOCK", name: "Block policy", priority: 100 });

    const result = resolveDecision(undefined, [allowPolicy, blockPolicy], makeInput());

    expect(result.decision).toBe("BLOCK");
    expect(result.matchedPolicySnapshots).toHaveLength(2);
    expect(result.matchedPolicySnapshots.map((p) => p.name).sort()).toEqual(
      ["Allow policy", "Block policy"].sort()
    );
  });

  it("among multiple policies at the same winning severity, the highest priority explains the decision", () => {
    const lowPriority = makePolicy({ decision: "BLOCK", name: "Low priority block", priority: 10 });
    const highPriority = makePolicy({ decision: "BLOCK", name: "High priority block", priority: 900 });

    const result = resolveDecision(undefined, [lowPriority, highPriority], makeInput());

    expect(result.decision).toBe("BLOCK");
    expect(result.reason).toContain("High priority block");
  });

  it("priority never overrides severity — a low-priority BLOCK still beats a high-priority ALLOW", () => {
    const highPriorityAllow = makePolicy({ decision: "ALLOW", name: "High priority allow", priority: 900 });
    const lowPriorityBlock = makePolicy({ decision: "BLOCK", name: "Low priority block", priority: 10 });

    const result = resolveDecision(undefined, [highPriorityAllow, lowPriorityBlock], makeInput());

    expect(result.decision).toBe("BLOCK");
    expect(result.reason).toContain("Low priority block");
  });

  it("prefers a matching policy over the baseline permission for the explanation, at equal severity", () => {
    const permission = makePermission({ decision: "BLOCK" });
    const policy = makePolicy({ decision: "BLOCK", name: "Named policy" });

    const result = resolveDecision(permission, [policy], makeInput());
    expect(result.reason).toContain("Named policy");
  });
});
