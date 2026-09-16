import { describe, expect, it } from "vitest";
import { getEnforcementConnector } from "@/lib/enforcement/registry";

describe("getEnforcementConnector", () => {
  it("always resolves to the null connector today — Aegis has no real enforcement integration", async () => {
    const connector = getEnforcementConnector({ id: "agent_1" });
    expect(connector.kind).toBe("null");

    const outcome = await connector.control("agent_1", "stop");
    expect(outcome.enforced).toBe(false);
    expect(outcome.mechanism).toBeNull();
    expect(outcome.detail).toMatch(/no enforcement connector/i);
  });

  it("never claims enforcement for any control action", async () => {
    const connector = getEnforcementConnector({ id: "agent_1" });
    for (const action of ["pause", "resume", "stop"] as const) {
      const outcome = await connector.control("agent_1", action);
      expect(outcome.enforced).toBe(false);
    }
  });
});
