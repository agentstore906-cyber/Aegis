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

import { AgentConnectionWizard } from "@/components/agents/agent-connection-wizard";
import { ConnectionInstructions } from "@/components/agents/connection/connection-instructions";
import { AgentDetected, connectedAgo } from "@/components/agents/connection/agent-detected";
import { AgentProtectionStatus } from "@/components/agents/connection/agent-protection-status";
import { ConnectionCredential } from "@/components/agents/connection/connection-credential";
import { ConnectionError } from "@/components/agents/connection/connection-error";
import { HandshakeState } from "@/components/agents/connection/handshake-state";
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
const snap = (v = view()): ConnectionSnapshotJson => ({
  agent: { id: "a1", slug: "support", name: "Customer Support Agent", environment: "PRODUCTION" },
  hasConnectionRecord: true,
  connectorType: "CUSTOM_SDK",
  view: v,
  baseline: null,
  eventsObserved: v.reportedEventCount,
  hasAllowRule: true,
});

describe("<AgentConnectionWizard> first screen", () => {
  const markup = renderToStaticMarkup(<AgentConnectionWizard atLimit={false} />);

  it("asks only for a friendly name, and offers one clear Connect action", () => {
    expect(markup).toContain("Connect your agent");
    expect(markup).toContain("Agent name");
    expect(markup).toContain("Customer Support Agent");
    expect(markup).toContain(">Continue<");
    expect(markup).toContain("Advanced options"); // environment is tucked away
  });
  it("exposes no identifiers, no credential, no demo agent and no success state before anything happened", () => {
    expect(markup).not.toMatch(/agent[_ ]id|organization[_ ]id|handshake|token|payload|base ?url/i);
    expect(markup).not.toMatch(/aegis_(live|test)_/);
    expect(markup).not.toMatch(/demo agent|sample/i);
    expect(markup).not.toMatch(/agent connected|detected|protected/i);
    expect(markup).toContain("Nothing is connected until your agent actually reaches Aegis.");
  });
  it("blocks at the plan limit", () => {
    expect(renderToStaticMarkup(<AgentConnectionWizard atLimit />)).toMatch(/agent limit/i);
  });
});

describe("<HandshakeState>", () => {
  it("is 'Waiting for your agent…' until the backend says connected — and says nothing has been received", () => {
    const html = renderToStaticMarkup(<HandshakeState snapshot={snap(view({ state: "WAITING" }))} problem={null} checkedAt={new Date("2026-10-03T10:00:00Z")} />);
    expect(html).toContain("Waiting for your agent…");
    expect(html).toContain("Nothing has been received yet");
    expect(html).not.toMatch(/Your agent has made contact/);
  });
  it("shows a failed status check as a failure, not as progress or silence", () => {
    const html = renderToStaticMarkup(<HandshakeState snapshot={null} problem="unreachable" checkedAt={null} />);
    expect(html).toMatch(/Could not reach Aegis/);
    expect(html).not.toMatch(/Nothing has been received/);
  });
  it("says connected only for a CONNECTED snapshot", () => {
    expect(renderToStaticMarkup(<HandshakeState snapshot={snap()} problem={null} checkedAt={new Date()} />)).toContain("Your agent has made contact.");
  });
});

describe("<AgentDetected>", () => {
  it("says Agent connected, names the agent, and links to it", () => {
    const html = renderToStaticMarkup(<AgentDetected snapshot={snap()} />);
    expect(html).toContain("Agent connected");
    expect(html).toContain("Customer Support Agent");
    expect(html).toContain("View agent");
    expect(html).toContain("/agents/support");
  });
  it("does not claim monitoring is active until an event has actually arrived", () => {
    const before = renderToStaticMarkup(<AgentDetected snapshot={snap()} />);
    expect(before).not.toContain("Monitoring is active");
    expect(before).toMatch(/Monitoring starts when your agent reports its first event/);
    const after = renderToStaticMarkup(<AgentDetected snapshot={snap(view({ monitoring: "RECEIVING", monitoringLabel: "Monitored", reportedEventCount: 2 }))} />);
    expect(after).toContain("Monitoring is active");
  });
  it("explains default-deny when nothing allows the agent, without making the connection look failed", () => {
    const html = renderToStaticMarkup(<AgentDetected snapshot={{ ...snap(), hasAllowRule: false }} />);
    expect(html).toContain("Agent connected");
    expect(html).toContain("No policy currently allows this agent");
    expect(html).toContain("Configure policies");
    expect(html).toContain("/agents/support?tab=permissions");
    expect(html).not.toMatch(/failed|error|problem/i);
    expect(renderToStaticMarkup(<AgentDetected snapshot={snap()} />)).not.toContain("Configure policies");
  });
  it("never claims protection or blocking, and only says it asks for decisions when it does", () => {
    const asks = renderToStaticMarkup(<AgentDetected snapshot={snap(view({ protection: "ASKS_FOR_DECISIONS" }))} />);
    expect(asks).toContain("Asks Aegis for decisions");
    for (const forbidden of FORBIDDEN_CLAIMS) expect(asks).not.toMatch(forbidden);
    expect(renderToStaticMarkup(<AgentDetected snapshot={snap()} />)).not.toContain("Asks Aegis for decisions");
  });
  it("says 'just now' only for a fresh connection", () => {
    const now = new Date("2026-10-03T10:00:30Z");
    expect(connectedAgo("2026-10-03T10:00:00.000Z", now)).toBe("Connected just now");
    expect(connectedAgo("2026-10-03T09:57:00.000Z", now)).toBe("Connected 3 minutes ago");
    expect(connectedAgo(null, now)).toBe("Connected");
  });
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
