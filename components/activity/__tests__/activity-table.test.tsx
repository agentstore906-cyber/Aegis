import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActivityEvent, Agent } from "@prisma/client";

// Keep the render hermetic: no Next runtime routing needed for a static <a>.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children as never}
    </a>
  ),
}));

import { ActivityTable } from "@/components/activity/activity-table";
import { ActivityRow } from "@/components/activity/activity-row";

type EventRow = ActivityEvent & { agent: Pick<Agent, "id" | "name" | "slug"> };

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "evt_1",
    organizationId: "org_1",
    agentId: "agent_1",
    timestamp: new Date("2026-09-13T10:42:00Z"),
    eventType: "TOOL_CALL",
    action: "crm_read",
    resource: "contact:acme-inc",
    description: null,
    toolName: "CRM",
    source: "api",
    status: "ALLOWED",
    riskLevel: "LOW",
    durationMs: null,
    modelProvider: null,
    modelName: null,
    costCents: null,
    inputTokens: null,
    outputTokens: null,
    taskId: null,
    taskType: null,
    traceId: null,
    parentEventId: null,
    errorMessage: null,
    metadata: null,
    agent: { id: "agent_1", name: "Sales Agent", slug: "sales-agent" },
    ...overrides,
  };
}

describe("<ActivityTable>", () => {
  it("renders a row per event with the reported action, resource, and status — never inventing extra rows", () => {
    const events = [
      makeEvent({ id: "evt_1", action: "crm_read", resource: "contact:acme-inc", status: "ALLOWED" }),
      makeEvent({
        id: "evt_2",
        action: "database_delete",
        resource: "Customer records",
        status: "BLOCKED",
        riskLevel: "HIGH",
      }),
    ];
    const markup = renderToStaticMarkup(<ActivityTable events={events} />);

    expect(markup).toContain("crm read");
    expect(markup).toContain("contact:acme-inc");
    expect(markup).toContain("database delete");
    expect(markup).toContain("Customer records");
    expect(markup).toContain("Allowed");
    expect(markup).toContain("Blocked");
    // +1 for the header row rendered by <Thead>.
    expect((markup.match(/<tr/g) ?? []).length).toBe(events.length + 1);
  });

  it("shows an explicit em dash, not a fabricated value, for fields Aegis was never told", () => {
    const event = makeEvent({ resource: null, toolName: null, durationMs: null, modelName: null, traceId: null });
    const markup = renderToStaticMarkup(<ActivityTable events={[event]} />);

    // 5 unavailable columns: resource, tool, duration, model, trace id
    expect((markup.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("renders real reported detail (duration, model, trace id) when it was actually observed", () => {
    const event = makeEvent({ durationMs: 842, modelName: "gpt-5", traceId: "trace_abc123" });
    const markup = renderToStaticMarkup(<ActivityTable events={[event]} />);

    expect(markup).toContain("842ms");
    expect(markup).toContain("gpt-5");
    expect(markup).toContain("trace_abc123");
  });
});

describe("<ActivityRow>", () => {
  it("falls back to the machine action code, not an invented description, when none was reported", () => {
    const markup = renderToStaticMarkup(
      <ActivityRow timestamp={new Date()} action="database_delete" resource="Customer records" status="BLOCKED" />
    );
    expect(markup).toContain("database delete");
    expect(markup).toContain("Customer records");
    expect(markup).toContain("Blocked");
  });

  it("prefers a caller-supplied description over the raw action code", () => {
    const markup = renderToStaticMarkup(
      <ActivityRow
        timestamp={new Date()}
        action="crm_read"
        description="Read customer record for Acme Corp"
        status="ALLOWED"
      />
    );
    expect(markup).toContain("Read customer record for Acme Corp");
  });

  it("omits the agent link entirely when no agent context was passed, rather than showing a blank/fake link", () => {
    const markup = renderToStaticMarkup(<ActivityRow timestamp={new Date()} action="crm_read" status="ALLOWED" />);
    expect(markup).not.toContain("/agents/");
  });
});
