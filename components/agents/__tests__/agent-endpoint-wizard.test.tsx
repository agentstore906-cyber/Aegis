import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/connect-actions", () => ({ connectEndpointAgentAction: vi.fn() }));

import { AgentConnectionWizard } from "@/components/agents/agent-connection-wizard";

const text = (atLimit = false) => renderToStaticMarkup(<AgentConnectionWizard atLimit={atLimit} />).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("<AgentConnectionWizard> — Aegis connects to a real external agent", () => {
  it("asks for the agent's endpoint and shared secret, not for a name to wait on", () => {
    const html = renderToStaticMarkup(<AgentConnectionWizard atLimit={false} />);
    expect(html).toContain("Agent endpoint URL");
    expect(html).toContain("Shared secret");
    expect(html).toMatch(/type="password"/);
    expect(text()).toContain("Connect Agent");
  });

  it("never offers the old wait-for-the-agent flow, and never says connected before anything happened", () => {
    const out = text();
    expect(out).not.toMatch(/waiting for (your|the) (ai )?agent/i);
    expect(out).not.toMatch(/run your agent once|AEGIS_API_KEY|credential below/i);
    expect(out).not.toMatch(/agent connected|verified it/i);
    expect(out).toContain("Nothing is added to Aegis unless the agent answers");
  });

  it("shows no identifiers, no demo agent and no safety claim", () => {
    const out = text();
    expect(out).not.toMatch(/organization_id|cuid|demo agent|sample agent/i);
    expect(out).not.toMatch(/\b(safe|secure|protected)\b/i);
  });

  it("disables Connect until both fields are filled in", () => {
    expect(renderToStaticMarkup(<AgentConnectionWizard atLimit={false} />)).toMatch(/<button[^>]*disabled[^>]*>\s*Connect Agent/);
  });

  it("blocks at the plan limit", () => {
    expect(text(true)).toContain("plan");
  });
});
