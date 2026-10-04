/** P0 §7 — API key → agent authorization rules. */
import { describe, expect, it } from "vitest";

import { apiKeyMayActAsAgent, apiKeyMayRegisterAgents } from "@/lib/api-keys/agent-binding";

describe("apiKeyMayActAsAgent", () => {
  it("an organization-wide key may act as any agent in its own organization", () => {
    expect(apiKeyMayActAsAgent({ agentId: null, organizationId: "org_1" }, { id: "agent_1", organizationId: "org_1" })).toBe(true);
  });

  it("a bound key may act only as its own agent", () => {
    const key = { agentId: "agent_1", organizationId: "org_1" };
    expect(apiKeyMayActAsAgent(key, { id: "agent_1", organizationId: "org_1" })).toBe(true);
    expect(apiKeyMayActAsAgent(key, { id: "agent_2", organizationId: "org_1" })).toBe(false);
  });

  it("no key may ever act as an agent of another organization", () => {
    expect(apiKeyMayActAsAgent({ agentId: null, organizationId: "org_1" }, { id: "agent_9", organizationId: "org_2" })).toBe(false);
    expect(apiKeyMayActAsAgent({ agentId: "agent_9", organizationId: "org_1" }, { id: "agent_9", organizationId: "org_2" })).toBe(false);
  });
});

describe("apiKeyMayRegisterAgents", () => {
  it("only organization-wide keys may register new agents", () => {
    expect(apiKeyMayRegisterAgents({ agentId: null, organizationId: "org_1" })).toBe(true);
    expect(apiKeyMayRegisterAgents({ agentId: "agent_1", organizationId: "org_1" })).toBe(false);
  });
});
