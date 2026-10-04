/**
 * Incident intelligence (P7 — docs/AEGIS_P7_INCIDENT_INTELLIGENCE.md).
 *
 * The reconstruction is a pure function of an EvidenceBundle: plain rows read
 * (tenant-scoped) from the append-only security records. Nothing in a timeline
 * item, summary claim or evidence record can exist without a row in the bundle
 * — that is what "never invent an event" means in code.
 */

export type EvidenceType =
  | "security_alert"
  | "alert_occurrence"
  | "activity_event"
  | "policy_evaluation"
  | "approval_request"
  | "approval_decision"
  | "behavioral_deviation"
  | "trust_transition"
  | "audit_event";

export type EvidenceRef = { type: EvidenceType; id: string };

export type AnchorType = "SECURITY_ALERT" | "POLICY_EVALUATION" | "ACTIVITY_EVENT";

export type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// -- Evidence bundle (inputs) ---------------------------------------------------

export type BundleAlert = {
  id: string;
  type: string;
  severity: Level;
  title: string;
  description: string;
  confidence: string | null;
  traceId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  count: number;
  evidence: unknown;
};

export type BundleOccurrence = { id: string; alertId: string; occurredAt: Date; severity: Level; title: string };

export type BundleEvent = {
  id: string;
  timestamp: Date;
  source: string;
  eventType: string;
  action: string;
  resource: string | null;
  toolName: string | null;
  toolKey: string | null;
  service: string | null;
  destination: string | null;
  dataClasses: string[];
  dataSensitivity: string | null;
  recordCount: number | null;
  byteCount: number | null;
  status: string;
  riskLevel: Level;
  outcome: string | null;
  evaluationId: string | null;
  parentEventId: string | null;
  taskId: string | null;
  endUserHash: string | null;
};

export type BundleEvaluation = {
  id: string;
  createdAt: Date;
  action: string;
  resource: string | null;
  decision: string;
  policyDecision: string | null;
  decisionSource: string | null;
  reason: string;
  matchedPolicies: { id: string; name: string; decision: string }[];
  permission: { action: string; decision: string } | null;
  riskAssessedLevel: Level | null;
  riskRecommendedDecision: string | null;
  riskControlOutcome: string | null;
  riskControlMode: string | null;
  riskSignals: { code: string; family: string; severity: string }[];
  trust: { state: string; score: number } | null;
  agentStatus: string | null;
  consumedApprovalRequestId: string | null;
  activityEventId: string | null;
};

export type BundleApproval = {
  id: string;
  policyEvaluationId: string;
  action: string;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
  consumedAt: Date | null;
  consumedByEvaluationId: string | null;
};

export type BundleApprovalDecision = {
  id: string;
  approvalRequestId: string;
  decision: string;
  decidedByUserId: string;
  decidedByLabel: string;
  comment: string | null;
  createdAt: Date;
};

export type BundleDeviation = {
  id: string;
  kind: string;
  confidence: string;
  observed: unknown;
  eventId: string | null;
  firstSeenAt: Date;
  occurrences: number;
  baselineVersion: number;
};

export type BundleTrust = {
  id: string;
  occurredAt: Date;
  previousState: string | null;
  newState: string;
  previousScore: number | null;
  newScore: number;
  trigger: string;
};

export type BundleControl = {
  id: string;
  eventType: string;
  createdAt: Date;
  actorLabel: string | null;
  reason: string | null;
};

export type EvidenceBundle = {
  incident: { id: string; number: number; anchorType: AnchorType; anchorId: string; traceId: string | null };
  agent: { id: string; name: string; slug: string };
  alerts: BundleAlert[];
  occurrences: BundleOccurrence[];
  events: BundleEvent[];
  evaluations: BundleEvaluation[];
  approvals: BundleApproval[];
  approvalDecisions: BundleApprovalDecision[];
  deviations: BundleDeviation[];
  trust: BundleTrust[];
  control: BundleControl[];
  /** A cap was reached reading that kind of evidence; more exists than is shown. */
  truncated: { events: boolean; evaluations: boolean; alerts: boolean; deviations: boolean };
};

// -- Reconstruction (outputs) -----------------------------------------------------

export type TimelineKind =
  | "ALERT"
  | "ACTION"
  | "DECISION"
  | "POLICY"
  | "RISK"
  | "DEVIATION"
  | "TRUST"
  | "APPROVAL"
  | "ENFORCEMENT"
  | "CONTROL"
  | "OUTCOME";

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

export type TimelineItem = {
  /** Deterministic: kind + the source row's id (+ a sub-part), so it is stable across reconstructions. */
  id: string;
  kind: TimelineKind;
  at: Date;
  title: string;
  /** Flat, display-safe facts taken from the evidence. */
  detail: Record<string, string | number | boolean | null>;
  /** At least one — every item is traceable to a stored row. */
  evidence: EvidenceRef[];
  /** The record that opened this incident. */
  trigger: boolean;
  tone: Tone;
};

export type EvidenceRecord = {
  ref: EvidenceRef;
  at: Date;
  label: string;
  href: string | null;
  /** The underlying facts (reasoning-shaped fields withheld, long values truncated). */
  data: unknown;
};

export type Claim = {
  text: string;
  /** What the sentence rests on. */
  evidence: EvidenceRef[];
  /** Refs beyond MAX_CLAIM_EVIDENCE are counted, not listed. */
  evidenceTotal: number;
};

export type IncidentSummary = {
  headline: string;
  /** The concise paragraph: only facts the telemetry supports. */
  paragraph: string;
  what: Claim[];
  why: Claim[];
  aegis: Claim[];
  /** What is NOT known or NOT shown, stated as plainly as the facts. */
  gaps: Claim[];
};

export type Reconstruction = {
  items: TimelineItem[];
  evidence: EvidenceRecord[];
  summary: IncidentSummary;
  /** Highest severity found in the evidence. */
  severity: Level;
  /** sha256 over the sorted evidence identities — changes only when evidence is added. */
  evidenceDigest: string;
  evidenceCount: number;
  context: {
    traceId: string | null;
    taskIds: string[];
    tools: string[];
    destinations: string[];
    dataClasses: string[];
  };
  truncated: EvidenceBundle["truncated"] & { items: boolean };
};
