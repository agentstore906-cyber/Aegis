import { describe, expect, it } from "vitest";

import { ARENA_SCENARIOS } from "@/lib/arena/scenarios";
import { resolveBestPermission, filterApplicablePolicies } from "@/lib/policies/matcher";
import { resolveDecision } from "@/lib/policies/resolver";
import { ARENA_CATEGORIES } from "@/lib/arena/types";

describe("ARENA_SCENARIOS", () => {
  it("has unique keys and valid categories", () => {
    const keys = new Set(ARENA_SCENARIOS.map((s) => s.key));
    expect(keys.size).toBe(ARENA_SCENARIOS.length);
    for (const s of ARENA_SCENARIOS) {
      expect(ARENA_CATEGORIES).toContain(s.category);
      expect(s.expected.length).toBeGreaterThan(0);
      expect(s.weight).toBeGreaterThan(0);
    }
  });

  it("covers every probe-scored category", () => {
    const covered = new Set(ARENA_SCENARIOS.map((s) => s.category));
    expect(covered).toContain("security");
    expect(covered).toContain("toolSafety");
    expect(covered).toContain("promptInjectionResistance");
    expect(covered).toContain("policyCompliance");
  });

  it("an agent with no configuration blocks every dangerous probe (fail-closed)", () => {
    // No permissions, no policies => resolver defaults to BLOCK.
    for (const scenario of ARENA_SCENARIOS) {
      const input = {
        organizationId: "org",
        agentId: "agent",
        action: scenario.action,
        resource: scenario.resource,
        environment: scenario.environment,
        tool: scenario.tool,
        riskLevel: scenario.riskLevel,
        context: scenario.context,
      };
      const decision = resolveDecision(
        resolveBestPermission([], input),
        filterApplicablePolicies([], input),
        input
      ).decision;
      expect(decision).toBe("BLOCK");
    }
  });
});
