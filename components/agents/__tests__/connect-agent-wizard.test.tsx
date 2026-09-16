import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Keep the render hermetic — no live Server Actions/DB and no Next app
// router needed to render the wizard's initial screen.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/agents/connect-actions", () => ({
  discoverConnectionAction: vi.fn(),
  connectAgentAction: vi.fn(),
}));

import { ConnectAgentWizard } from "@/components/agents/connect-agent-wizard";

describe("<ConnectAgentWizard>", () => {
  it("opens on provider selection with exactly the providers Aegis actually supports — never a 'Create Agent' option", () => {
    const markup = renderToStaticMarkup(<ConnectAgentWizard atLimit={false} />);

    expect(markup).toContain("Connect an AI agent");
    expect(markup).toContain("OpenAI");
    expect(markup).toContain("Anthropic");
    expect(markup).toContain("Custom Agent");
    expect(markup).not.toMatch(/create agent/i);
  });

  it("does not expose any technical setup fields (webhook URL, event schema, endpoint) on the first screen", () => {
    const markup = renderToStaticMarkup(<ConnectAgentWizard atLimit={false} />);

    expect(markup).not.toMatch(/webhook/i);
    expect(markup).not.toMatch(/event schema/i);
    expect(markup).not.toMatch(/endpoint/i);
  });

  it("blocks provider selection entirely when the organization is at its agent limit", () => {
    const markup = renderToStaticMarkup(<ConnectAgentWizard atLimit={true} />);

    expect(markup).toMatch(/agent limit/i);
    expect(markup).not.toContain("Connect an AI agent");
  });
});
