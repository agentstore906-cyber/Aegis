import "server-only";

import type { Incident, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type {
  AnchorType,
  BundleAlert,
  BundleApproval,
  BundleApprovalDecision,
  BundleControl,
  BundleDeviation,
  BundleEvaluation,
  BundleEvent,
  BundleOccurrence,
  BundleTrust,
  EvidenceBundle,
  Level,
} from "@/lib/incidents/types";

/**
 * Reads the stored evidence for one incident. Every query filters on
 * organizationId AND agentId (the incident's own), so evidence from another
 * tenant — or another agent — can never enter a bundle, even if a stored link
 * pointed at it. Every read is capped; hitting a cap is reported
 * (`truncated`) and surfaces as a stated gap in the summary.
 */

export const EVIDENCE_CAPS = { events: 200, evaluations: 200, alerts: 50, deviations: 100, occurrences: 300, trust: 30, control: 30 } as const;
const WINDOW_AFTER_MS = 5 * 60 * 1000;
const CONTROL_EVENT_TYPES = ["agent.paused", "agent.resumed", "agent.stopped"];

const EVENT_SELECT = {
  id: true,
  timestamp: true,
  source: true,
  eventType: true,
  action: true,
  resource: true,
  toolName: true,
  toolKey: true,
  service: true,
  destination: true,
  dataClasses: true,
  dataSensitivity: true,
  recordCount: true,
  byteCount: true,
  status: true,
  riskLevel: true,
  outcome: true,
  evaluationId: true,
  parentEventId: true,
  taskId: true,
  endUserHash: true,
} satisfies Prisma.ActivityEventSelect;

const EVALUATION_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  resource: true,
  decision: true,
  policyDecision: true,
  decisionSource: true,
  reason: true,
  matchedPolicySnapshots: true,
  permissionSnapshot: true,
  riskAssessedLevel: true,
  riskRecommendedDecision: true,
  riskControlOutcome: true,
  riskControlMode: true,
  riskControl: true,
  agentStatus: true,
  consumedApprovalRequestId: true,
  activityEventId: true,
} satisfies Prisma.PolicyEvaluationSelect;

const ALERT_SELECT = {
  id: true,
  type: true,
  severity: true,
  title: true,
  description: true,
  confidence: true,
  traceId: true,
  firstSeenAt: true,
  lastSeenAt: true,
  count: true,
  evidence: true,
} satisfies Prisma.SecurityAlertSelect;

type EventRow = Prisma.ActivityEventGetPayload<{ select: typeof EVENT_SELECT }>;
type EvaluationRow = Prisma.PolicyEvaluationGetPayload<{ select: typeof EVALUATION_SELECT }>;

const toEvent = (e: EventRow): BundleEvent => ({ ...e, riskLevel: e.riskLevel as Level, dataSensitivity: e.dataSensitivity });

function toEvaluation(e: EvaluationRow): BundleEvaluation {
  const control = (e.riskControl ?? null) as { signals?: { code: string; family: string; severity: string }[]; trust?: { state: string; score: number } | null } | null;
  const policies = (e.matchedPolicySnapshots ?? []) as { id: string; name: string; decision: string }[];
  const permission = e.permissionSnapshot as { action?: string; decision?: string } | null;
  return {
    id: e.id,
    createdAt: e.createdAt,
    action: e.action,
    resource: e.resource,
    decision: e.decision,
    policyDecision: e.policyDecision,
    decisionSource: e.decisionSource,
    reason: e.reason,
    matchedPolicies: policies.map((p) => ({ id: p.id, name: p.name, decision: p.decision })),
    permission: permission?.action && permission.decision ? { action: permission.action, decision: permission.decision } : null,
    riskAssessedLevel: e.riskAssessedLevel as Level | null,
    riskRecommendedDecision: e.riskRecommendedDecision,
    riskControlOutcome: e.riskControlOutcome,
    riskControlMode: e.riskControlMode,
    riskSignals: control?.signals ?? [],
    trust: control?.trust ? { state: control.trust.state, score: control.trust.score } : null,
    agentStatus: e.agentStatus,
    consumedApprovalRequestId: e.consumedApprovalRequestId,
    activityEventId: e.activityEventId,
  };
}

const toAlert = (a: Prisma.SecurityAlertGetPayload<{ select: typeof ALERT_SELECT }>): BundleAlert => ({ ...a, severity: a.severity as Level });

export async function loadEvidenceBundle(incident: Incident): Promise<EvidenceBundle | null> {
  const { organizationId, agentId, traceId } = incident;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId }, select: { id: true, name: true, slug: true } });
  if (!agent) return null;
  const anchorType = incident.anchorType as AnchorType;

  const base = { organizationId, agentId };
  const caps = EVIDENCE_CAPS;

  // The run's records (when the trigger belongs to a run) ...
  const [traceEvents, traceEvaluations, traceAlerts] = traceId
    ? await Promise.all([
        prisma.activityEvent.findMany({ where: { ...base, traceId }, orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: caps.events + 1, select: EVENT_SELECT }),
        prisma.policyEvaluation.findMany({ where: { ...base, traceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: caps.evaluations + 1, select: EVALUATION_SELECT }),
        prisma.securityAlert.findMany({ where: { ...base, traceId }, orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }], take: caps.alerts + 1, select: ALERT_SELECT }),
      ])
    : [[], [], []];

  const truncated = {
    events: traceEvents.length > caps.events,
    evaluations: traceEvaluations.length > caps.evaluations,
    alerts: traceAlerts.length > caps.alerts,
    deviations: false,
  };

  const events = new Map<string, EventRow>(traceEvents.slice(0, caps.events).map((e) => [e.id, e]));
  const evaluations = new Map<string, EvaluationRow>(traceEvaluations.slice(0, caps.evaluations).map((e) => [e.id, e]));
  const alerts = new Map(traceAlerts.slice(0, caps.alerts).map((a) => [a.id, a]));

  // ... plus the trigger itself, always, even if it fell outside a cap or has no run.
  if (anchorType === "SECURITY_ALERT" && !alerts.has(incident.anchorId)) {
    const a = await prisma.securityAlert.findFirst({ where: { ...base, id: incident.anchorId }, select: ALERT_SELECT });
    if (a) alerts.set(a.id, a);
  }
  if (anchorType === "POLICY_EVALUATION" && !evaluations.has(incident.anchorId)) {
    const e = await prisma.policyEvaluation.findFirst({ where: { ...base, id: incident.anchorId }, select: EVALUATION_SELECT });
    if (e) evaluations.set(e.id, e);
  }
  if (anchorType === "ACTIVITY_EVENT" && !events.has(incident.anchorId)) {
    const e = await prisma.activityEvent.findFirst({ where: { ...base, id: incident.anchorId }, select: EVENT_SELECT });
    if (e) events.set(e.id, e);
  }
  // A trigger without a run still brings the decision/event it is the other half of.
  if (!traceId) {
    const anchorEvent = anchorType === "ACTIVITY_EVENT" ? events.get(incident.anchorId) : undefined;
    const anchorEval = anchorType === "POLICY_EVALUATION" ? evaluations.get(incident.anchorId) : undefined;
    if (anchorEval?.activityEventId) {
      const e = await prisma.activityEvent.findFirst({ where: { ...base, id: anchorEval.activityEventId }, select: EVENT_SELECT });
      if (e) events.set(e.id, e);
    }
    if (anchorEvent) {
      const linkedEvaluation = await prisma.policyEvaluation.findFirst({
        where: { ...base, OR: [{ activityEventId: anchorEvent.id }, ...(anchorEvent.evaluationId ? [{ id: anchorEvent.evaluationId }] : [])] },
        select: EVALUATION_SELECT,
      });
      if (linkedEvaluation) evaluations.set(linkedEvaluation.id, linkedEvaluation);
    }
  }

  const eventIds = [...events.keys()];
  const evaluationIds = [...evaluations.keys()];
  const alertIds = [...alerts.keys()];

  const [occurrences, approvals, deviations] = await Promise.all([
    alertIds.length
      ? prisma.securityAlertOccurrence.findMany({
          where: { organizationId, alertId: { in: alertIds } },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          take: caps.occurrences,
          select: { id: true, alertId: true, occurredAt: true, severity: true, title: true },
        })
      : Promise.resolve([]),
    evaluationIds.length
      ? prisma.approvalRequest.findMany({
          where: { ...base, policyEvaluationId: { in: evaluationIds } },
          orderBy: { requestedAt: "asc" },
          select: {
            id: true,
            policyEvaluationId: true,
            action: true,
            status: true,
            requestedAt: true,
            resolvedAt: true,
            consumedAt: true,
            consumedByEvaluationId: true,
            decisions: { orderBy: { createdAt: "asc" }, select: { id: true, approvalRequestId: true, decision: true, decidedByUserId: true, comment: true, createdAt: true, decidedBy: { select: { name: true, email: true } } } },
          },
        })
      : Promise.resolve([]),
    eventIds.length
      ? prisma.behavioralDeviation.findMany({
          where: { ...base, eventId: { in: eventIds } },
          orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
          take: caps.deviations + 1,
          select: { id: true, kind: true, confidence: true, observed: true, eventId: true, firstSeenAt: true, occurrences: true, baselineVersion: true },
        })
      : Promise.resolve([]),
  ]);
  truncated.deviations = deviations.length > caps.deviations;

  // Trust changes and operator control that happened while this was unfolding.
  const times = [
    ...[...events.values()].map((e) => e.timestamp.getTime()),
    ...[...evaluations.values()].map((e) => e.createdAt.getTime()),
    ...[...alerts.values()].map((a) => a.firstSeenAt.getTime()),
    ...occurrences.map((o) => o.occurredAt.getTime()),
  ];
  let trust: BundleTrust[] = [];
  let control: BundleControl[] = [];
  if (times.length) {
    const from = new Date(Math.min(...times));
    const to = new Date(Math.max(...times) + WINDOW_AFTER_MS);
    const [trustRows, controlRows] = await Promise.all([
      prisma.agentTrustTransition.findMany({
        where: { ...base, occurredAt: { gte: from, lte: to } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: caps.trust,
        select: { id: true, occurredAt: true, previousState: true, newState: true, previousScore: true, newScore: true, trigger: true },
      }),
      prisma.auditEvent.findMany({
        where: { organizationId, agentId, eventType: { in: CONTROL_EVENT_TYPES }, createdAt: { gte: from, lte: to } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: caps.control,
        select: { id: true, eventType: true, createdAt: true, actorUserId: true, metadata: true },
      }),
    ]);
    trust = trustRows;
    const actorIds = [...new Set(controlRows.flatMap((c) => (c.actorUserId ? [c.actorUserId] : [])))];
    const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
    const label = (id: string | null) => {
      const u = actors.find((a) => a.id === id);
      return u ? (u.name ?? u.email) : null;
    };
    control = controlRows.map((c) => ({
      id: c.id,
      eventType: c.eventType,
      createdAt: c.createdAt,
      actorLabel: label(c.actorUserId),
      reason: typeof (c.metadata as { reason?: unknown } | null)?.reason === "string" ? ((c.metadata as { reason: string }).reason) : null,
    }));
  }

  const bundleApprovals: BundleApproval[] = approvals.map((a) => ({
    id: a.id,
    policyEvaluationId: a.policyEvaluationId,
    action: a.action,
    status: a.status,
    requestedAt: a.requestedAt,
    resolvedAt: a.resolvedAt,
    consumedAt: a.consumedAt,
    consumedByEvaluationId: a.consumedByEvaluationId,
  }));
  const approvalDecisions: BundleApprovalDecision[] = approvals.flatMap((a) =>
    a.decisions.map((d) => ({
      id: d.id,
      approvalRequestId: d.approvalRequestId,
      decision: d.decision,
      decidedByUserId: d.decidedByUserId,
      decidedByLabel: d.decidedBy.name ?? d.decidedBy.email,
      comment: d.comment,
      createdAt: d.createdAt,
    }))
  );
  const bundleOccurrences: BundleOccurrence[] = occurrences.map((o) => ({ ...o, severity: o.severity as Level }));
  const bundleDeviations: BundleDeviation[] = deviations.slice(0, caps.deviations);

  return {
    incident: { id: incident.id, number: incident.number, anchorType, anchorId: incident.anchorId, traceId },
    agent,
    alerts: [...alerts.values()].map(toAlert),
    occurrences: bundleOccurrences,
    events: [...events.values()].map(toEvent),
    evaluations: [...evaluations.values()].map(toEvaluation),
    approvals: bundleApprovals,
    approvalDecisions,
    deviations: bundleDeviations,
    trust,
    control,
    truncated,
  };
}
