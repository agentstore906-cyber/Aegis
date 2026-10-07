import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentNode, type AgentNodeData } from "@/components/console/agent-node";

const agent = (over: Partial<AgentNodeData> = {}): AgentNodeData => ({
  slug: "support",
  name: "Support agent",
  status: "ACTIVE",
  connection: { state: "CONNECTED", monitoring: "RECEIVING", lastSeenAt: new Date() },
  lastActivityAt: new Date(),
  openAlerts: 0,
  ...over,
});

// Visible text only: class names and data attributes are not what a person reads.
const html = (a: AgentNodeData) => renderToStaticMarkup(<AgentNode agent={a} />).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("agent card — factual state only, no score", () => {
  it("shows connection, monitoring, last activity and alerts", () => {
    const out = html(agent({ openAlerts: 3 }));
    expect(out).toContain("Connected");
    expect(out).toContain("Monitoring active");
    expect(out).toContain("Last activity");
    expect(out).toContain("3 open alerts");
  });

  it("never renders a risk score, risk meter, configured-risk label or trust number", () => {
    for (const a of [agent(), agent({ openAlerts: 7 }), agent({ openAlerts: undefined }), agent({ connection: { state: "REVOKED", monitoring: "RECEIVING", lastSeenAt: null } })]) {
      const out = html(a);
      expect(out).not.toMatch(/risk/i);
      expect(out).not.toMatch(/trust/i);
      expect(out).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    }
  });

  it("does not claim safety, and does not invent an alert count the viewer may not see", () => {
    const out = html(agent({ openAlerts: undefined }));
    expect(out).not.toMatch(/\b(safe|secure|protected)\b/i);
    expect(out).not.toMatch(/alert/i);
  });

  it("a disconnected agent is not described as monitored", () => {
    const out = html(agent({ connection: { state: "REVOKED", monitoring: "RECEIVING", lastSeenAt: null }, lastActivityAt: null }));
    expect(out).toContain("Disconnected");
    expect(out).toContain("Not receiving");
    expect(out).not.toContain("Monitoring active");
  });

  it("'Last activity' is real activity only: a connection check is shown as 'Last seen', and nothing as nothing", () => {
    expect(html(agent({ lastActivityAt: null }))).toContain("Last seen");
    expect(html(agent({ lastActivityAt: null }))).not.toContain("Last activity");
    const none = html(agent({ lastActivityAt: null, connection: { state: "CONNECTED", monitoring: "NONE", lastSeenAt: null } }));
    expect(none).toContain("No activity received yet");
    expect(none).toContain("Not monitored yet");
  });

  it("an agent that is not active says so, once, by name", () => {
    expect(html(agent({ status: "PAUSED" }))).toContain("Paused");
    expect(html(agent())).not.toMatch(/\bActive\b/);
  });
});
