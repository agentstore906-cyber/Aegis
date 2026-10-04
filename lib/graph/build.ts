import { sanitizeContext, shortText } from "@/lib/graph/sanitize";
import type {
  ActionGraph,
  EventView,
  GraphEdge,
  GraphEdgeKind,
  GraphEventRow,
  GraphNode,
  GraphNodeKind,
  ItemFlag,
  ParentStatus,
  TimelineItem,
} from "@/lib/graph/types";

/**
 * Builds the action graph for ONE PAGE of one run's events. Pure and
 * deterministic: same rows in, same graph out, whatever order they arrive in.
 *
 * Ordering. Aegis's own receipt time (`timestamp`) is the trusted ordering;
 * `occurredAt` (what the caller claims) is carried but never used to sort.
 * Ties break on id. Siblings and roots are in that order.
 *
 * Structure. Parent links come from P1 lineage (parentEventId). A page can
 * contain an event whose parent is not on the page, so every root says WHY it
 * is a root (ParentStatus): a true root, a parent the caller named that has
 * not arrived, a parent on another page, a parent outside this run, or — never
 * expected, but never fatal — a loop.
 *
 * No recursion anywhere: a 10,000-deep chain builds in linear time without
 * touching the call stack.
 */

export type MissingParentKind = "same_run" | "elsewhere";

export type BuildInput = {
  agent: { id: string; name: string; slug: string };
  traceId: string;
  rows: GraphEventRow[];
  /**
   * For events whose parentEventId is not on this page: whether the parent
   * exists in this same run (another page) or not. Absent id = not found.
   */
  parentLookup?: Map<string, MissingParentKind>;
};

const compare = (a: GraphEventRow, b: GraphEventRow) => a.timestamp.getTime() - b.timestamp.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const BAD_DECISIONS = new Set(["BLOCK", "REQUIRE_APPROVAL"]);
const EXECUTED = new Set(["SUCCESS", "WARNING"]);
const HIGH = new Set(["HIGH", "CRITICAL"]);

function flagsFor(row: GraphEventRow): ItemFlag[] {
  const flags: ItemFlag[] = [];
  if (row.status === "BLOCKED" || row.decision?.decision === "BLOCK") flags.push("blocked");
  if (row.status === "APPROVAL_REQUIRED" || row.decision?.decision === "REQUIRE_APPROVAL") flags.push("approval_required");
  if (row.decision?.approval?.status === "PENDING") flags.push("approval_pending");
  if (row.decision?.decisionSource === "RISK") flags.push("risk_gated");
  // Observed fact, not an accusation: a decision said no / not yet, and the agent reported the action succeeded anyway.
  if (row.ranUnder && BAD_DECISIONS.has(row.ranUnder.decision) && row.outcome && EXECUTED.has(row.outcome)) {
    flags.push("executed_despite_decision");
  }
  if (HIGH.has(row.riskLevel)) flags.push("high_risk");
  if (row.deviations.length > 0) flags.push("behavioral_deviation");
  return flags;
}

function viewOf(row: GraphEventRow): EventView {
  const { metadata, riskSignals, errorMessage, description, ...rest } = row;
  const context = sanitizeContext(metadata);
  return {
    ...rest,
    description: shortText(description),
    errorMessage: shortText(errorMessage),
    context: context.value,
    contextWithheld: context.withheld,
    signals: Array.isArray(riskSignals)
      ? (riskSignals as { code?: unknown; detail?: unknown }[]).flatMap((s) => (typeof s?.code === "string" ? [{ code: s.code, detail: s.detail }] : []))
      : [],
  };
}

export function buildActionGraph(input: BuildInput): ActionGraph {
  const rows = [...input.rows].sort(compare);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lookup = input.parentLookup ?? new Map<string, MissingParentKind>();

  // --- Tree ---------------------------------------------------------------
  const items = new Map<string, TimelineItem>();
  for (const row of rows) {
    items.set(row.id, {
      id: row.id,
      depth: 0,
      event: viewOf(row),
      parent: { status: "root", parentEventId: row.parentEventId, parentClientEventId: row.parentClientEventId },
      flags: flagsFor(row),
      children: [],
    });
  }

  const roots: TimelineItem[] = [];
  const parentOf = new Map<string, string>();
  for (const row of rows) {
    const item = items.get(row.id)!;
    if (row.parentEventId && row.parentEventId !== row.id && byId.has(row.parentEventId)) {
      items.get(row.parentEventId)!.children.push(item); // rows are sorted, so children are too
      parentOf.set(row.id, row.parentEventId);
      item.parent.status = "linked";
      continue;
    }
    let status: ParentStatus;
    if (row.parentEventId === row.id) status = "cycle";
    else if (row.parentEventId) status = lookup.get(row.parentEventId) === "same_run" ? "outside_page" : "unavailable";
    else status = row.parentClientEventId ? "awaiting_parent" : "root";
    item.parent.status = status;
    roots.push(item);
  }

  // Depth by iterative traversal; anything unreachable from a root is a loop.
  const visited = new Set<string>();
  const walk = (start: TimelineItem, depth: number) => {
    const stack: TimelineItem[] = [];
    start.depth = depth;
    stack.push(start);
    while (stack.length) {
      const node = stack.pop()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      for (const child of node.children) {
        child.depth = node.depth + 1;
        stack.push(child);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  while (visited.size < rows.length) {
    const orphan = rows.find((r) => !visited.has(r.id))!;
    const item = items.get(orphan.id)!;
    const parentId = parentOf.get(orphan.id);
    if (parentId) {
      const siblings = items.get(parentId)!.children;
      siblings.splice(siblings.indexOf(item), 1);
    }
    item.parent.status = "cycle";
    roots.push(item);
    walk(item, 0);
  }
  roots.sort((a, b) => compare(byId.get(a.id)!, byId.get(b.id)!));

  // --- Entities and edges --------------------------------------------------
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (kind: GraphNodeKind, key: string, label: string, attrs: Record<string, unknown> = {}) => {
    const id = `${kind.toLowerCase()}:${key}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, attrs });
    return id;
  };
  const edge = (kind: GraphEdgeKind, from: string, to: string) => {
    const id = `${kind}:${from}>${to}`;
    if (!edges.has(id)) edges.set(id, { id, kind, from, to });
  };

  const agentNode = node("AGENT", input.agent.id, input.agent.name, { slug: input.agent.slug });
  const rootIds = new Set(roots.map((r) => r.id));

  for (const row of rows) {
    const actionNode = node("ACTION", row.id, row.action, {
      eventType: row.eventType,
      resource: row.resource,
      timestamp: row.timestamp.toISOString(),
      status: row.status,
      riskLevel: row.riskLevel,
      source: row.source,
    });

    if (row.endUserHash) {
      // Pseudonym only — the raw end-user id is never stored (P1).
      const user = node("USER", row.endUserHash, `End user ${row.endUserHash.slice(0, 8)}`, { pseudonym: true });
      edge("ACTED_THROUGH", user, agentNode);
    }

    const task = node("TASK", row.taskId ?? "run", row.taskId ? `Task ${row.taskId}` : `Run ${input.traceId.slice(0, 12)}`, {
      taskId: row.taskId,
      taskType: row.taskType,
      traceId: input.traceId,
    });
    edge("RAN", agentNode, task);
    if (rootIds.has(row.id)) edge("STARTED", task, actionNode);

    const parent = row.parentEventId && byId.has(row.parentEventId) && row.parentEventId !== row.id ? row.parentEventId : null;
    if (parent) edge("CAUSED", `action:${parent}`, actionNode);

    if (row.toolKey) edge("USED_TOOL", actionNode, node("TOOL", row.toolKey, row.toolName ?? row.toolKey, { toolKey: row.toolKey }));

    const api = row.destination ?? row.service;
    if (api) {
      edge(
        "CALLED",
        actionNode,
        node("API", api, api, { service: row.service, destination: row.destination, destinationKind: row.destinationKind })
      );
    }

    for (const dataClass of row.dataClasses) edge("ACCESSED", actionNode, node("DATA", dataClass, dataClass, { dataClass }));

    // The result is observable, not inferred: a decision when this event is
    // an /evaluate call, a reported outcome when it is an execution.
    const result = row.decision
      ? { label: `Decided ${row.decision.decision}`, attrs: { kind: "decision", decision: row.decision.decision, source: row.decision.decisionSource } }
      : row.outcome
        ? { label: `Reported ${row.outcome.toLowerCase()}`, attrs: { kind: "outcome", outcome: row.outcome } }
        : { label: row.status.replaceAll("_", " ").toLowerCase(), attrs: { kind: "status", status: row.status } };
    edge("RESULTED_IN", actionNode, node("RESULT", row.id, result.label, result.attrs));
  }

  const attention = rows
    .map((r) => ({ id: r.id, flags: items.get(r.id)!.flags }))
    .filter((a) => a.flags.length > 0);

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    timeline: roots,
    attention,
    counts: { events: rows.length, roots: roots.length, orphans: roots.filter((r) => r.parent.status !== "root").length },
  };
}
