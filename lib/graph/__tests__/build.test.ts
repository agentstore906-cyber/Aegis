import { describe, expect, it } from "vitest";

import { buildActionGraph } from "@/lib/graph/build";
import type { DecisionInfo, GraphEventRow, TimelineItem } from "@/lib/graph/types";

const T0 = new Date("2026-10-07T10:00:00.000Z").getTime();
const agent = { id: "agent_1", name: "Support Bot", slug: "support-bot" };

let n = 0;
function row(over: Partial<GraphEventRow> & { id: string }): GraphEventRow {
  n += 1;
  return {
    timestamp: new Date(T0 + n * 1000),
    occurredAt: null,
    eventType: "ACTION",
    action: "crm.read",
    resource: null,
    description: null,
    toolName: null,
    toolKey: null,
    service: null,
    destination: null,
    destinationKind: null,
    endUserHash: null,
    dataClasses: [],
    dataSensitivity: null,
    recordCount: null,
    byteCount: null,
    status: "ALLOWED",
    riskLevel: "LOW",
    outcome: null,
    source: "api",
    durationMs: null,
    taskId: null,
    taskType: null,
    clientEventId: null,
    parentEventId: null,
    parentClientEventId: null,
    evaluationId: null,
    errorMessage: null,
    metadata: null,
    riskSignals: null,
    decision: null,
    ranUnder: null,
    deviations: [],
    ...over,
  };
}

const build = (rows: GraphEventRow[], parentLookup?: Map<string, "same_run" | "elsewhere">) =>
  buildActionGraph({ agent, traceId: "trace-1234567890abcdef", rows, parentLookup });

const flat = (items: TimelineItem[]): TimelineItem[] => items.flatMap((i) => [i, ...flat(i.children)]);
const ids = (items: TimelineItem[]) => items.map((i) => i.id);

const decision = (over: Partial<DecisionInfo> = {}): DecisionInfo => ({
  evaluationId: "eval_1",
  decision: "ALLOW",
  policyDecision: "ALLOW",
  decisionSource: "POLICY",
  reason: "Allowed by permission.",
  matchedPolicies: [],
  permission: { action: "crm.read", decision: "ALLOW" },
  riskLevel: "LOW",
  riskRecommended: "ALLOW",
  riskControlOutcome: "OBSERVED",
  riskControlMode: "OBSERVE",
  riskSignals: [],
  trust: { state: "TRUSTED", score: 95 },
  approval: null,
  consumedApprovalRequestId: null,
  createdAt: new Date(T0),
  ...over,
});

describe("construction", () => {
  it("represents USER → AGENT → TASK → TOOL → API → DATA → ACTION → RESULT from the events' own fields", () => {
    const g = build([
      row({
        id: "e1",
        action: "crm.export",
        toolName: "CRM",
        toolKey: "crm",
        service: "crm-api",
        destination: "api.crm.example.com",
        destinationKind: "HOST",
        endUserHash: "abcdef0123456789",
        dataClasses: ["PII", "FINANCIAL"],
        taskId: "task-9",
        taskType: "export",
        outcome: "SUCCESS",
      }),
    ]);
    const kinds = new Set(g.nodes.map((x) => x.kind));
    expect(kinds).toEqual(new Set(["USER", "AGENT", "TASK", "TOOL", "API", "DATA", "ACTION", "RESULT"]));
    const edgeKinds = g.edges.map((e) => e.kind).sort();
    expect(edgeKinds).toEqual(["ACCESSED", "ACCESSED", "ACTED_THROUGH", "CALLED", "RAN", "RESULTED_IN", "STARTED", "USED_TOOL"]);
    expect(g.nodes.find((x) => x.kind === "TASK")?.label).toBe("Task task-9");
    expect(g.nodes.find((x) => x.kind === "USER")?.label).toBe("End user abcdef01"); // pseudonym prefix only
    expect(g.nodes.find((x) => x.kind === "API")?.id).toBe("api:api.crm.example.com");
    expect(g.nodes.find((x) => x.kind === "RESULT")?.label).toBe("Reported success");
  });

  it("does not invent entities that were not reported", () => {
    const g = build([row({ id: "e1" })]);
    expect(new Set(g.nodes.map((x) => x.kind))).toEqual(new Set(["AGENT", "TASK", "ACTION", "RESULT"]));
    expect(g.nodes.find((x) => x.kind === "TASK")?.label).toBe("Run trace-123456");
  });

  it("dedupes shared entities across events and links each to every action that used it", () => {
    const g = build([
      row({ id: "e1", toolKey: "crm", destination: "a.example.com", dataClasses: ["PII"], endUserHash: "u1u1u1u1u1" }),
      row({ id: "e2", toolKey: "crm", destination: "a.example.com", dataClasses: ["PII"], endUserHash: "u1u1u1u1u1" }),
    ]);
    expect(g.nodes.filter((x) => x.kind === "TOOL")).toHaveLength(1);
    expect(g.nodes.filter((x) => x.kind === "API")).toHaveLength(1);
    expect(g.nodes.filter((x) => x.kind === "DATA")).toHaveLength(1);
    expect(g.nodes.filter((x) => x.kind === "USER")).toHaveLength(1);
    expect(g.edges.filter((e) => e.kind === "USED_TOOL")).toHaveLength(2);
    expect(g.edges.filter((e) => e.kind === "ACTED_THROUGH")).toHaveLength(1);
  });

  it("uses a service as the API node when there is no destination", () => {
    const g = build([row({ id: "e1", service: "billing-api" })]);
    expect(g.nodes.find((x) => x.kind === "API")?.id).toBe("api:billing-api");
  });

  it("shows a decision as the result of an /evaluate event and an outcome for an execution", () => {
    const g = build([
      row({ id: "d", source: "policy_evaluation", decision: decision({ decision: "BLOCK" }), status: "BLOCKED" }),
      row({ id: "x", parentEventId: "d", outcome: "FAILURE" }),
    ]);
    expect(g.nodes.find((x) => x.id === "result:d")?.label).toBe("Decided BLOCK");
    expect(g.nodes.find((x) => x.id === "result:x")?.label).toBe("Reported failure");
  });
});

describe("parent/child relationships and ordering", () => {
  it("nests children under parents and orders siblings by receipt time then id", () => {
    const g = build([
      row({ id: "c2", parentEventId: "p", timestamp: new Date(T0 + 30_000) }),
      row({ id: "p", timestamp: new Date(T0 + 10_000) }),
      row({ id: "c1", parentEventId: "p", timestamp: new Date(T0 + 20_000) }),
      row({ id: "g", parentEventId: "c1", timestamp: new Date(T0 + 25_000) }),
    ]);
    expect(ids(g.timeline)).toEqual(["p"]);
    const p = g.timeline[0];
    expect(ids(p.children)).toEqual(["c1", "c2"]);
    expect(ids(p.children[0].children)).toEqual(["g"]);
    expect(flat(g.timeline).map((i) => i.depth)).toEqual([0, 1, 2, 1]);
    expect(g.edges.filter((e) => e.kind === "CAUSED").map((e) => `${e.from}>${e.to}`).sort()).toEqual(["action:c1>action:g", "action:p>action:c1", "action:p>action:c2"]);
  });

  it("is independent of input order", () => {
    const rows = [row({ id: "a" }), row({ id: "b", parentEventId: "a" }), row({ id: "c", parentEventId: "a" }), row({ id: "d" })];
    const forward = build(rows);
    const reversed = build([...rows].reverse());
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("breaks timestamp ties by id", () => {
    const t = new Date(T0);
    const g = build([row({ id: "b", timestamp: t }), row({ id: "a", timestamp: t }), row({ id: "c", timestamp: t })]);
    expect(ids(g.timeline)).toEqual(["a", "b", "c"]);
  });

  it("sorts by Aegis's receipt time, never the caller's claimed occurredAt", () => {
    const g = build([
      row({ id: "later", timestamp: new Date(T0 + 5_000), occurredAt: new Date(T0 - 99_000) }),
      row({ id: "earlier", timestamp: new Date(T0 + 1_000), occurredAt: new Date(T0 + 99_000) }),
    ]);
    expect(ids(g.timeline)).toEqual(["earlier", "later"]);
    expect(g.timeline[1].event.occurredAt).toEqual(new Date(T0 - 99_000));
  });

  it("handles a late-linked parent that was RECEIVED after its child", () => {
    const g = build([
      row({ id: "child", parentEventId: "parent", timestamp: new Date(T0 + 1_000) }),
      row({ id: "parent", timestamp: new Date(T0 + 9_000) }),
    ]);
    // Parent sorts after the child on the timeline, but the relationship is intact and nothing is dropped.
    expect(g.counts.events).toBe(2);
    expect(g.timeline.map((i) => i.id)).toEqual(["parent"]);
    expect(g.timeline[0].children.map((i) => i.id)).toEqual(["child"]);
  });
});

describe("missing parents", () => {
  it("a true root says root", () => {
    expect(build([row({ id: "a" })]).timeline[0].parent.status).toBe("root");
  });

  it("a caller-named parent that has not arrived is awaiting_parent, and the event is kept as a root", () => {
    const g = build([row({ id: "a", parentClientEventId: "client-parent-1" })]);
    expect(g.timeline[0].parent).toEqual({ status: "awaiting_parent", parentEventId: null, parentClientEventId: "client-parent-1" });
    expect(g.counts).toEqual({ events: 1, roots: 1, orphans: 1 });
  });

  it("a parent on another page is outside_page; a parent not in the run is unavailable", () => {
    const g = build(
      [row({ id: "a", parentEventId: "elsewhere-page" }), row({ id: "b", parentEventId: "gone" }), row({ id: "c", parentEventId: "other-run" })],
      new Map([
        ["elsewhere-page", "same_run" as const],
        ["other-run", "elsewhere" as const],
      ])
    );
    const status = Object.fromEntries(g.timeline.map((i) => [i.id, i.parent.status]));
    expect(status).toEqual({ a: "outside_page", b: "unavailable", c: "unavailable" });
    expect(g.timeline.every((i) => i.parent.parentEventId)).toBe(true);
  });

  it("an unresolvable parent is never fabricated into a node or an edge", () => {
    const g = build([row({ id: "a", parentEventId: "ghost" })]);
    expect(g.nodes.some((x) => x.id === "action:ghost")).toBe(false);
    expect(g.edges.some((e) => e.kind === "CAUSED")).toBe(false);
  });

  it("a child whose parent is missing still keeps its own children", () => {
    const g = build([row({ id: "a", parentEventId: "ghost" }), row({ id: "b", parentEventId: "a" })]);
    expect(g.timeline.map((i) => i.id)).toEqual(["a"]);
    expect(g.timeline[0].children.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("robustness", () => {
  it("survives parent loops by showing them as roots flagged cycle", () => {
    const g = build([row({ id: "a", parentEventId: "b" }), row({ id: "b", parentEventId: "a" }), row({ id: "s", parentEventId: "s" })]);
    expect(g.counts.events).toBe(3);
    expect(flat(g.timeline)).toHaveLength(3);
    expect(g.timeline.filter((i) => i.parent.status === "cycle").length).toBeGreaterThanOrEqual(2);
  });

  it("builds a 10,000-deep chain without recursion (no stack overflow) and keeps depth", () => {
    const rows: GraphEventRow[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      rows.push(row({ id: `n${String(i).padStart(5, "0")}`, parentEventId: i === 0 ? null : `n${String(i - 1).padStart(5, "0")}`, timestamp: new Date(T0 + i) }));
    }
    const g = build(rows);
    expect(g.counts).toEqual({ events: 10_000, roots: 1, orphans: 0 });
    let node = g.timeline[0];
    let depth = 0;
    while (node.children.length) {
      node = node.children[0];
      depth += 1;
    }
    expect(depth).toBe(9_999);
    expect(node.depth).toBe(9_999);
  });

  it("builds a wide fan-out (5,000 children of one parent) in order", () => {
    const rows: GraphEventRow[] = [row({ id: "root", timestamp: new Date(T0) })];
    for (let i = 0; i < 5_000; i += 1) rows.push(row({ id: `c${String(i).padStart(5, "0")}`, parentEventId: "root", timestamp: new Date(T0 + 1 + i) }));
    const g = build(rows);
    expect(g.timeline[0].children).toHaveLength(5_000);
    expect(g.timeline[0].children[0].id).toBe("c00000");
    expect(g.timeline[0].children[4_999].id).toBe("c04999");
  });

  it("an empty page is an empty graph", () => {
    const g = build([]);
    expect(g.timeline).toEqual([]);
    expect(g.nodes.map((x) => x.kind)).toEqual(["AGENT"]);
    expect(g.counts).toEqual({ events: 0, roots: 0, orphans: 0 });
  });
});

describe("decisions, approvals, blocked actions and risk", () => {
  it("flags blocked, gated, risk-gated, pending-approval and high-risk events", () => {
    const g = build([
      row({ id: "blocked", status: "BLOCKED", decision: decision({ decision: "BLOCK" }), source: "policy_evaluation" }),
      row({
        id: "gated",
        status: "APPROVAL_REQUIRED",
        riskLevel: "HIGH",
        source: "policy_evaluation",
        decision: decision({ decision: "REQUIRE_APPROVAL", decisionSource: "RISK", approval: { id: "ap1", status: "PENDING", expiresAt: null, resolvedAt: null } }),
      }),
      row({ id: "ok" }),
    ]);
    const flags = Object.fromEntries(g.timeline.map((i) => [i.id, i.flags]));
    expect(flags.blocked).toEqual(["blocked"]);
    expect(flags.gated).toEqual(expect.arrayContaining(["approval_required", "approval_pending", "risk_gated", "high_risk"]));
    expect(flags.ok).toEqual([]);
    expect(g.attention.map((a) => a.id)).toEqual(["blocked", "gated"]);
  });

  it("states an observed fact when an execution was reported under a BLOCK or REQUIRE_APPROVAL decision, and not otherwise", () => {
    const g = build([
      row({ id: "d", source: "policy_evaluation", decision: decision({ decision: "BLOCK" }), status: "BLOCKED" }),
      row({ id: "x", parentEventId: "d", evaluationId: "eval_1", ranUnder: { evaluationId: "eval_1", decision: "BLOCK", decisionSource: "POLICY" }, outcome: "SUCCESS" }),
      row({ id: "y", parentEventId: "d", evaluationId: "eval_1", ranUnder: { evaluationId: "eval_1", decision: "BLOCK", decisionSource: "POLICY" }, outcome: "BLOCKED" }),
      row({ id: "z", ranUnder: { evaluationId: "e2", decision: "ALLOW", decisionSource: "POLICY" }, outcome: "SUCCESS" }),
    ]);
    const byId = Object.fromEntries(flat(g.timeline).map((i) => [i.id, i.flags]));
    expect(byId.x).toContain("executed_despite_decision");
    expect(byId.y).not.toContain("executed_despite_decision");
    expect(byId.z).not.toContain("executed_despite_decision");
  });

  it("carries behavioral deviations and the decision details through to the item", () => {
    const g = build([
      row({ id: "d", source: "policy_evaluation", decision: decision({ matchedPolicies: [{ id: "p1", name: "No exports", decision: "BLOCK" }] }), deviations: [{ kind: "NEW_DESTINATION", confidence: "HIGH", explanation: "New destination." }] }),
    ]);
    const item = g.timeline[0];
    expect(item.flags).toContain("behavioral_deviation");
    expect(item.event.decision?.matchedPolicies[0].name).toBe("No exports");
    expect(item.event.deviations[0].kind).toBe("NEW_DESTINATION");
  });
});

describe("only observable metadata is shown", () => {
  it("withholds reasoning-shaped context fields and says so, keeps ordinary fields, truncates long text", () => {
    const g = build([
      row({
        id: "e1",
        description: "x".repeat(1000),
        metadata: { amount: 1250, reasoning: "I should export because...", nested: { chain_of_thought: "step 1", ok: "fine" }, failure_reason: "timeout" },
      }),
    ]);
    const event = g.timeline[0].event;
    expect(event.contextWithheld).toBe(true);
    expect(event.context).toEqual({
      amount: 1250,
      reasoning: "[withheld: reasoning content]",
      nested: { chain_of_thought: "[withheld: reasoning content]", ok: "fine" },
      failure_reason: "timeout",
    });
    expect(event.description!.length).toBeLessThanOrEqual(301);
    expect(JSON.stringify(g)).not.toContain("I should export");
    expect(JSON.stringify(g)).not.toContain("step 1");
  });
});
