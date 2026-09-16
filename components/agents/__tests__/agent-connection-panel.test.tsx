import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/connect-actions", () => ({
  checkConnectionHealthAction: vi.fn(),
  reconnectAgentAction: vi.fn(),
  disconnectAgentAction: vi.fn(),
}));

import { AgentConnectionPanel } from "@/components/agents/agent-connection-panel";
import type { ConnectorCapabilities } from "@/lib/connectors/types";

const OPENAI_CAPABILITIES: ConnectorCapabilities = {
  agentDiscovery: true,
  activityMonitoring: true,
  usageMonitoring: false,
  costMonitoring: false,
  pauseAgent: false,
  killSwitch: false,
  credentialVerification: true,
};

function baseProps(overrides: Partial<Parameters<typeof AgentConnectionPanel>[0]> = {}) {
  return {
    agentSlug: "sales-agent",
    connectorType: "OPENAI" as const,
    status: "CONNECTED" as const,
    externalAccountLabel: "sk-...ab12",
    capabilities: OPENAI_CAPABILITIES,
    connectedAtLabel: "Sep 1, 2026",
    lastVerifiedAtLabel: "2 hours ago",
    lastHealthCheckAtLabel: "2 hours ago",
    lastHealthError: null,
    canManage: true,
    ...overrides,
  };
}

describe("<AgentConnectionPanel>", () => {
  it("never renders a capability the connector doesn't actually support", () => {
    const markup = renderToStaticMarkup(<AgentConnectionPanel {...baseProps()} />);

    // OpenAI's capabilities here have pauseAgent/killSwitch/usage/cost sync
    // all false — none of their labels may appear.
    expect(markup).not.toMatch(/kill switch/i);
    expect(markup).not.toMatch(/pause agent/i);
    expect(markup).not.toMatch(/usage sync/i);
    expect(markup).not.toMatch(/cost sync/i);
    // The capabilities that ARE true must actually show up.
    expect(markup).toContain("Agent discovery");
    expect(markup).toContain("Activity monitoring");
  });

  it("shows the masked account label, never a raw credential", () => {
    const markup = renderToStaticMarkup(<AgentConnectionPanel {...baseProps()} />);
    expect(markup).toContain("sk-...ab12");
  });

  it("shows 'Connection needs to be renewed' only when the status actually requires it", () => {
    const healthy = renderToStaticMarkup(<AgentConnectionPanel {...baseProps({ status: "CONNECTED" })} />);
    expect(healthy).not.toMatch(/needs to be renewed/i);

    const needsReconnect = renderToStaticMarkup(
      <AgentConnectionPanel {...baseProps({ status: "RECONNECT_REQUIRED" })} />
    );
    expect(needsReconnect).toMatch(/needs to be renewed/i);
  });

  it("hides all management actions for a viewer without manage_agents", () => {
    const markup = renderToStaticMarkup(<AgentConnectionPanel {...baseProps({ canManage: false })} />);
    expect(markup).not.toContain("Disconnect");
    expect(markup).not.toContain("Check connection");
  });

  it("hides 'Check connection' and 'Disconnect' once already disconnected, but still offers Reconnect", () => {
    const markup = renderToStaticMarkup(<AgentConnectionPanel {...baseProps({ status: "DISCONNECTED" })} />);
    expect(markup).not.toContain("Check connection");
    // "Disconnected" (the status badge) legitimately contains the substring
    // "Disconnect" — assert against the destructive button's own dialog
    // title instead, which only renders when the action is actually offered.
    expect(markup).not.toContain("Disconnect agent");
    expect(markup).toContain("Reconnect");
    expect(markup).toMatch(/historical activity is preserved/i);
  });
});
