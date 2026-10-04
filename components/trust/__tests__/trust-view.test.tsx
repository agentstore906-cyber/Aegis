import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentTrustTransition } from "@prisma/client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children as never}
    </a>
  ),
}));

import { TrustDetails, TrustSummary } from "@/components/trust/trust-view";
import type { TrustView } from "@/lib/trust/queries";

const view = (overrides: Partial<TrustView> = {}): TrustView => ({
  state: "DEGRADED",
  score: 52,
  stateSince: new Date("2026-10-09T10:00:00Z"),
  evaluatedAt: new Date("2026-10-10T10:00:00Z"),
  methodologyVersion: 1,
  headline: "Degraded because of: New destination: evil.example.com (−10).",
  evidenceScore: 52,
  omittedFactors: 0,
  limits: [],
  categories: [{ category: "behavior", label: "Behavioral deviations", count: 1, raw: 10, applied: 10, cap: 40, capped: false }],
  factors: [
    {
      key: "behavior:NEW_DESTINATION:destination:evil.example.com",
      category: "behavior",
      code: "NEW_DESTINATION",
      points: 10,
      summary: "New destination: evil.example.com",
      at: "2026-10-10T09:00:00.000Z",
      evidence: [{ type: "behavioral_deviation", id: "d1" }],
    },
  ],
  ...overrides,
});

const transition = (overrides: Partial<AgentTrustTransition> = {}): AgentTrustTransition =>
  ({
    id: "t1",
    organizationId: "o",
    agentId: "a",
    sequence: 2,
    occurredAt: new Date("2026-10-09T10:00:00Z"),
    previousState: "NORMAL",
    newState: "DEGRADED",
    previousScore: 84,
    newScore: 52,
    trigger: "ACTIVITY_EVENT",
    triggerRef: "e1",
    summary: "Trust degraded from Normal to Degraded (84 → 52) because New destination: evil.example.com.",
    factors: [],
    limits: [],
    changes: [],
    methodologyVersion: 1,
    ...overrides,
  }) as AgentTrustTransition;

describe("TrustSummary", () => {
  it("answers 'what state' and 'why' and links to the tab", () => {
    const html = renderToStaticMarkup(<TrustSummary slug="support-bot" trust={view()} />);
    expect(html).toContain("Degraded");
    expect(html).toContain("52/100");
    expect(html).toContain("New destination: evil.example.com");
    expect(html).toContain('href="/agents/support-bot?tab=trust"');
  });
});

describe("TrustDetails", () => {
  it("shows the state, the evidence with its points, the history with reasons, and that trust is informational", () => {
    const html = renderToStaticMarkup(<TrustDetails trust={view()} transitions={[transition(), transition({ id: "t0", sequence: 1, previousState: null, previousScore: null, newState: "NORMAL", newScore: 84, summary: "Trust initialized as Normal (score 84)." })]} />);
    expect(html).toContain("−10");
    expect(html).toContain("Behavioral deviations");
    expect(html).toContain("84 → 52");
    expect(html).toContain("Degraded");
    expect(html).toContain("Initialized");
    expect(html).toContain("Trust initialized as Normal (score 84).");
    expect(html).toContain("does not block or change any");
  });

  it("explains limits (operator control, insufficient history) and the empty states plainly", () => {
    const html = renderToStaticMarkup(
      <TrustDetails
        trust={view({ state: "RESTRICTED", factors: [], limits: [{ code: "OPERATOR_CONTROL", ceiling: null, summary: "An operator paused this agent, so it is restricted until it is resumed." }] })}
        transitions={[]}
      />
    );
    expect(html).toContain("Operator control");
    expect(html).toContain("restricted until it is resumed");
    expect(html).toContain("No trust changes recorded yet.");
  });

  it("says when categories are capped and when smaller factors are omitted", () => {
    const html = renderToStaticMarkup(
      <TrustDetails
        trust={view({ omittedFactors: 3, categories: [{ category: "blocked", label: "Blocked actions", count: 40, raw: 120, applied: 30, cap: 30, capped: true }] })}
        transitions={[]}
      />
    );
    expect(html).toContain("3 smaller factors not listed");
    expect(html).toContain("Blocked actions are capped at −30");
  });
});
