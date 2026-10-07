import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/agents/connect-actions", () => ({
  connectAgentAction: vi.fn(),
  discoverConnectionAction: vi.fn(),
  checkConnectionHealthAction: vi.fn(),
  reconnectAgentAction: vi.fn(),
  disconnectAgentAction: vi.fn(),
}));

import { ConnectionInstructions } from "@/components/agents/connection/connection-instructions";
import { AgentProtectionStatus } from "@/components/agents/connection/agent-protection-status";
import { ConnectionCredential } from "@/components/agents/connection/connection-credential";
import { ConnectionError } from "@/components/agents/connection/connection-error";
import { AgentConnectionPanel } from "@/components/agents/agent-connection-panel";
import type { ConnectionSnapshotJson } from "@/components/agents/connection/use-connection-status";
import { FORBIDDEN_CLAIMS } from "@/lib/ui/vocabulary";

const view = (over: Partial<ConnectionSnapshotJson["view"]> = {}): ConnectionSnapshotJson["view"] => ({
  state: "CONNECTED",
  stateLabel: "Connected",
  detail: "A request authenticated with this agent's credential has reached Aegis.",
  reason: null,
  monitoring: "NONE",
  monitoringLabel: "Not monitored yet",
  protection: "MONITORING_ONLY",
  protectionLabel: "Monitoring only",
  protectionDetail: "Aegis sees what the agent reports and cannot stop its actions.",
  steps: [
    { key: "identity", label: "Identity verified", done: true, at: "2026-10-03T10:00:00.000Z" },
    { key: "connection", label: "Connection established", done: true, at: "2026-10-03T10:00:00.000Z" },
    { key: "activity", label: "First activity received", done: false, at: null },
  ],
  firstHandshakeAt: "2026-10-03T10:00:00.000Z",
  lastSeenAt: "2026-10-03T10:00:00.000Z",
  reportedEventCount: 0,
  ...over,
});
describe("<ConnectionInstructions>", () => {
  const key = "aegis_live_abcdefghijklmnopqrstuvwxyz0123456789";
  const html = renderToStaticMarkup(<ConnectionInstructions secret={key} />);
  it("never tells a customer to install a package that is not publicly available", () => {
    expect(html).not.toMatch(/npm install|npm i |yarn add|pnpm add/);
    expect(html).toContain("Nothing to install");
  });
  it("defaults to the setup that works today, with a Copy setup action, and labels the SDK early access", () => {
    expect(html).toContain("Copy setup");
    expect(html).toContain("/api/v1/connect/handshake");
    expect(html).toContain("/api/v1/events");
    expect(html).toContain("Aegis SDK (early access)");
  });
  it("shows no internal identifiers and keeps the real key out of the visible markup", () => {
    expect(html).not.toContain(key);
    expect(html).not.toMatch(/agent[_ ]id|organization[_ ]id/i);
  });
});

describe("<AgentProtectionStatus>", () => {
  it("keeps connection, monitoring and decisions apart, and never says Protected", () => {
    const html = renderToStaticMarkup(<AgentProtectionStatus view={view()} />);
    for (const label of ["Connection", "Monitoring", "Decisions"]) expect(html).toContain(label);
    expect(html).toContain("Monitoring only");
    for (const forbidden of FORBIDDEN_CLAIMS) expect(html).not.toMatch(forbidden);
  });
});

describe("<ConnectionCredential>", () => {
  const secret = "aegis_live_abcdefghijklmnopqrstuvwxyz0123456789";
  it("is masked by default so it is not sitting in the page", () => {
    const html = renderToStaticMarkup(<ConnectionCredential secret={secret} />);
    expect(html).not.toContain(secret);
    expect(html).toContain("Reveal");
    expect(html).toContain("Copy");
    expect(html).toMatch(/Shown once/);
  });
});

describe("<ConnectionError>", () => {
  it("lists only the reasons it is given, and offers retry only when it can", () => {
    const bare = renderToStaticMarkup(<ConnectionError message="The credential was revoked." />);
    expect(bare).toContain("The credential was revoked.");
    expect(bare).not.toMatch(/<ul/);
    expect(bare).not.toContain("Retry");
    const withRetry = renderToStaticMarkup(<ConnectionError message="x" reasons={["Invalid credential"]} onRetry={() => {}} />);
    expect(withRetry).toContain("Invalid credential");
    expect(withRetry).toContain("Retry");
    expect(bare).not.toMatch(/something went wrong/i);
  });
});

describe("<AgentConnectionPanel> with derived state", () => {
  const props = {
    agentSlug: "support",
    connectorType: "CUSTOM_SDK" as const,
    status: "CONNECTED" as const, // the stored status says connected…
    externalAccountLabel: "Aegis SDK",
    capabilities: { agentDiscovery: false, activityMonitoring: true, usageMonitoring: false, costMonitoring: false, pauseAgent: false, killSwitch: false, credentialVerification: false },
    connectedAtLabel: "Oct 3",
    lastVerifiedAtLabel: null,
    lastHealthCheckAtLabel: null,
    lastHealthError: null,
    canManage: true,
  };
  it("shows the evidence-based state, not the stored status", () => {
    const html = renderToStaticMarkup(<AgentConnectionPanel {...props} derived={{ state: "WAITING", stateLabel: "Waiting for your agent", detail: "A credential was issued.", reason: null, lastSeenLabel: null }} />);
    expect(html).toContain("Waiting for your agent");
    expect(html).not.toMatch(/>Connected</);
  });
  it("explains what revoking does before it happens", () => {
    const html = renderToStaticMarkup(<AgentConnectionPanel {...props} />);
    expect(html).toContain("Disconnect");
  });
});
