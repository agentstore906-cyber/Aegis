/**
 * Agent Action Graph (P6 — docs/AEGIS_P6_ACTION_GRAPH.md). A READ MODEL: it is
 * built on demand from ActivityEvent rows (P1 lineage), their linked policy
 * evaluation / approval, and P2 deviations. Nothing here is stored.
 *
 * Only observable action and context metadata ever appears. Aegis does not
 * collect an agent's reasoning, and free-form caller metadata is stripped of
 * reasoning-shaped fields before it reaches a graph (lib/graph/sanitize.ts).
 */

export type GraphNodeKind = "USER" | "AGENT" | "TASK" | "TOOL" | "API" | "DATA" | "ACTION" | "RESULT";

export type GraphEdgeKind =
  | "ACTED_THROUGH" // USER  → AGENT   an end user the agent acted for (pseudonym)
  | "RAN" //           AGENT → TASK
  | "STARTED" //       TASK  → ACTION  a root action of the task/run
  | "CAUSED" //        ACTION → ACTION parent → child (P1 lineage)
  | "USED_TOOL" //     ACTION → TOOL
  | "CALLED" //        ACTION → API    destination / service
  | "ACCESSED" //      ACTION → DATA   a data class
  | "RESULTED_IN"; //  ACTION → RESULT decision or outcome

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  attrs: Record<string, unknown>;
};

export type GraphEdge = { id: string; kind: GraphEdgeKind; from: string; to: string };

/** The decision recorded for an event that was an /evaluate call. */
export type DecisionInfo = {
  evaluationId: string;
  decision: string;
  /** What permissions and policies alone resolved to (P5); null on older rows. */
  policyDecision: string | null;
  decisionSource: string | null;
  reason: string;
  matchedPolicies: { id: string; name: string; decision: string }[];
  permission: { action: string; decision: string } | null;
  riskLevel: string | null;
  riskRecommended: string | null;
  riskControlOutcome: string | null;
  riskControlMode: string | null;
  riskSignals: { code: string; family: string; severity: string }[];
  trust: { state: string; score: number } | null;
  approval: { id: string; status: string; expiresAt: Date | null; resolvedAt: Date | null } | null;
  consumedApprovalRequestId: string | null;
  createdAt: Date;
};

/** Everything the builder needs about one event — plain data, no ORM types. */
export type GraphEventRow = {
  id: string;
  timestamp: Date;
  occurredAt: Date | null;
  eventType: string;
  action: string;
  resource: string | null;
  description: string | null;
  toolName: string | null;
  toolKey: string | null;
  service: string | null;
  destination: string | null;
  destinationKind: string | null;
  endUserHash: string | null;
  dataClasses: string[];
  dataSensitivity: string | null;
  recordCount: number | null;
  byteCount: number | null;
  status: string;
  riskLevel: string;
  outcome: string | null;
  source: string;
  durationMs: number | null;
  taskId: string | null;
  taskType: string | null;
  clientEventId: string | null;
  parentEventId: string | null;
  parentClientEventId: string | null;
  evaluationId: string | null;
  errorMessage: string | null;
  metadata: unknown;
  riskSignals: unknown;
  /** Set when this event is the record of an /evaluate decision. */
  decision: DecisionInfo | null;
  /** Set when this event is a reported execution that ran under an /evaluate decision. */
  ranUnder: { evaluationId: string; decision: string; decisionSource: string | null } | null;
  deviations: { kind: string; confidence: string; explanation: string }[];
};

/** Why an event with no linked parent on this page is a root. */
export type ParentStatus =
  /** A true root: it names no parent. */
  | "root"
  /** Names a parent that is on this page. */
  | "linked"
  /** Reported a parent by the caller's own id that Aegis has not received (yet). */
  | "awaiting_parent"
  /** Its parent exists in this run but on another page — follow the cursors. */
  | "outside_page"
  /** Its parent is not in this run (missing, or not visible to this organization's agent). */
  | "unavailable"
  /** Its parent chain loops (should be impossible; shown rather than crashing). */
  | "cycle";

export type ItemFlag =
  | "blocked"
  | "approval_required"
  | "approval_pending"
  | "risk_gated"
  | "executed_despite_decision"
  | "high_risk"
  | "behavioral_deviation";

/** The observable, display-safe view of one event. */
export type EventView = Omit<GraphEventRow, "metadata" | "riskSignals" | "errorMessage" | "description"> & {
  description: string | null;
  errorMessage: string | null;
  /** Caller metadata with reasoning-shaped fields withheld and long values truncated. */
  context: unknown;
  /** Reasoning-shaped fields were withheld from `context`. */
  contextWithheld: boolean;
  /** P1 ingest-time signals: [{ code, detail }]. */
  signals: { code: string; detail?: unknown }[];
};

export type TimelineItem = {
  id: string;
  depth: number;
  event: EventView;
  parent: { status: ParentStatus; parentEventId: string | null; parentClientEventId: string | null };
  flags: ItemFlag[];
  children: TimelineItem[];
};

export type ActionGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Roots in temporal order; each carries its descendants (within this page). */
  timeline: TimelineItem[];
  /** Items worth a security engineer's attention first (this page only), in temporal order. */
  attention: { id: string; flags: ItemFlag[] }[];
  counts: { events: number; roots: number; orphans: number };
};
