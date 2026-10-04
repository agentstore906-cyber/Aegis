import { createHash } from "node:crypto";

import { sanitizeContext } from "@/lib/graph/sanitize";
import type {
  BundleEvaluation,
  BundleEvent,
  Claim,
  EvidenceBundle,
  EvidenceRecord,
  EvidenceRef,
  IncidentSummary,
  Level,
  Reconstruction,
  TimelineItem,
  TimelineKind,
  Tone,
} from "@/lib/incidents/types";

/**
 * Incident reconstruction — a pure, deterministic function of an
 * EvidenceBundle (rows read, tenant-scoped, from the append-only security
 * records). The same bundle always produces the same timeline, summary and
 * digest.
 *
 * "Never invent an event" is structural here:
 *   - every timeline item is generated from exactly one stored row (or one
 *     snapshot stored inside it, such as a matched-policy entry) and carries a
 *     reference to that row;
 *   - every summary sentence is a template filled ONLY with values read from
 *     the bundle, and carries references to the rows it counts;
 *   - absence is never turned into a claim: when something is missing the
 *     summary says it is not recorded (the `gaps`), it does not guess.
 *
 * Wording follows docs/enforcement.md: Aegis "returned" decisions; it does not
 * claim an action was prevented. What the agent then did is only what the
 * agent reported.
 */

export const MAX_ITEMS = 600;
export const MAX_CLAIM_EVIDENCE = 25;

const LEVELS: readonly Level[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const levelRank = (l: Level) => LEVELS.indexOf(l);
const maxLevel = (a: Level, b: Level) => (levelRank(b) > levelRank(a) ? b : a);

const STRICTNESS: Record<string, number> = { ALLOW: 0, ALERT: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 };
const KIND_RANK: Record<TimelineKind, number> = {
  ACTION: 1,
  DECISION: 2,
  POLICY: 3,
  RISK: 4,
  DEVIATION: 5,
  ENFORCEMENT: 6,
  ALERT: 7,
  TRUST: 8,
  APPROVAL: 9,
  CONTROL: 10,
  OUTCOME: 11,
};

const lower = (s: string) => s.replaceAll("_", " ").toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const fmt = (n: number) => n.toLocaleString("en-US");
const short = (s: string, max = 300) => (s.length > max ? `${s.slice(0, max)}…` : s);

function listOf(items: string[], max = 4): string {
  const unique = [...new Set(items)];
  if (unique.length <= max) {
    return unique.length <= 1 ? unique.join("") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  }
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

const refKey = (r: EvidenceRef) => `${r.type}:${r.id}`;
function dedupe(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(refKey(r)) ? false : (seen.add(refKey(r)), true)));
}
function claim(text: string, refs: EvidenceRef[]): Claim {
  const all = dedupe(refs);
  return { text, evidence: all.slice(0, MAX_CLAIM_EVIDENCE), evidenceTotal: all.length };
}

const sourceLabel: Record<string, string> = {
  POLICY: "a policy or permission",
  DEFAULT_DENY: "default deny (no rule matched)",
  CONTROL: "the kill switch",
  APPROVAL: "an approval check",
  RISK: "risk control",
};

/** Short, factual description of a P2 behavioral deviation from its stored `observed` values. */
export function describeDeviation(kind: string, observed: unknown, confidence: string): string {
  const o = (observed && typeof observed === "object" ? observed : {}) as Record<string, unknown>;
  const value = o.value === undefined ? null : String(o.value);
  const conf = `${confidence.toLowerCase()} confidence`;
  switch (kind) {
    case "NEW_DESTINATION":
      return `new destination "${value}" (not in the agent's baseline, ${conf})`;
    case "NEW_TOOL":
      return `new tool "${value}" (not in the agent's baseline, ${conf})`;
    case "NEW_SERVICE":
      return `new service "${value}" (not in the agent's baseline, ${conf})`;
    case "NEW_ACTION_TYPE":
      return `new action type "${value}" (not in the agent's baseline, ${conf})`;
    case "UNUSUAL_DATA_TYPE":
      return `unusual data type "${value}" (not in the agent's baseline, ${conf})`;
    case "UNUSUAL_SEQUENCE":
      return `unusual action sequence "${value}" (not seen in the agent's baseline, ${conf})`;
    case "NEW_END_USER":
      return `an end user the agent had not served before (${conf})`;
    case "UNUSUAL_VOLUME":
      return `unusual volume: ${typeof o.value === "number" ? fmt(o.value) : value} ${String(o.unit ?? "")}${typeof o.ratioToP95 === "number" ? ` (${o.ratioToP95}× its 95th percentile)` : ""} (${conf})`.replace(/\s+\(/, " (");
    case "UNUSUAL_FREQUENCY":
      return `unusual frequency: ${typeof o.events === "number" ? fmt(o.events) : "?"} events in one hour (${conf})`;
    case "UNUSUAL_TIME":
      return `activity at an unusual hour (${typeof o.hourOfDayUtc === "number" ? `${String(o.hourOfDayUtc).padStart(2, "0")}:00 UTC` : "unknown"}, ${conf})`;
    default:
      return `${lower(kind)} (${conf})`;
  }
}

function toneForDecision(decision: string): Tone {
  return decision === "BLOCK" ? "danger" : decision === "ALLOW" ? "success" : "warning";
}
function toneForLevel(level: Level): Tone {
  return level === "CRITICAL" || level === "HIGH" ? "danger" : level === "MEDIUM" ? "warning" : "neutral";
}

const volume = (e: BundleEvent) => {
  const parts = [e.recordCount !== null ? `${fmt(e.recordCount)} records` : null, e.byteCount !== null ? `${fmt(e.byteCount)} bytes` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

// ---------------------------------------------------------------------------

/** Rows in a canonical order (time, then id), so nothing downstream depends on the order the database returned them. */
function canonical(bundle: EvidenceBundle): EvidenceBundle {
  const by = <T extends { id: string }>(time: (row: T) => Date) => (a: T, b: T) => time(a).getTime() - time(b).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    ...bundle,
    alerts: [...bundle.alerts].sort(by((a) => a.firstSeenAt)),
    occurrences: [...bundle.occurrences].sort(by((o) => o.occurredAt)),
    events: [...bundle.events].sort(by((e) => e.timestamp)),
    evaluations: [...bundle.evaluations].sort(by((e) => e.createdAt)),
    approvals: [...bundle.approvals].sort(by((a) => a.requestedAt)),
    approvalDecisions: [...bundle.approvalDecisions].sort(by((d) => d.createdAt)),
    deviations: [...bundle.deviations].sort(by((d) => d.firstSeenAt)),
    trust: [...bundle.trust].sort(by((t) => t.occurredAt)),
    control: [...bundle.control].sort(by((c) => c.createdAt)),
  };
}

export function reconstructIncident(input: EvidenceBundle): Reconstruction {
  const bundle = canonical(input);
  const { incident, agent } = bundle;
  const evalById = new Map(bundle.evaluations.map((e) => [e.id, e]));
  const evalByEventId = new Map(bundle.evaluations.flatMap((e) => (e.activityEventId ? [[e.activityEventId, e] as const] : [])));
  const eventById = new Map(bundle.events.map((e) => [e.id, e]));
  const approvalByEval = new Map(bundle.approvals.map((a) => [a.policyEvaluationId, a]));

  const items: TimelineItem[] = [];
  const add = (item: Omit<TimelineItem, "trigger"> & { trigger?: boolean }) => items.push({ ...item, trigger: item.trigger ?? false });

  // --- Security alerts ------------------------------------------------------
  for (const alert of bundle.alerts) {
    const occs = bundle.occurrences.filter((o) => o.alertId === alert.id).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1));
    const isAnchor = incident.anchorType === "SECURITY_ALERT" && incident.anchorId === alert.id;
    if (occs.length === 0) {
      add({
        id: `ALERT:${alert.id}`,
        kind: "ALERT",
        at: alert.firstSeenAt,
        title: `Security alert raised: ${alert.title} (${lower(alert.severity)})`,
        detail: { type: alert.type, severity: alert.severity, confidence: alert.confidence, occurrences: alert.count },
        evidence: [{ type: "security_alert", id: alert.id }],
        tone: toneForLevel(alert.severity),
        trigger: isAnchor,
      });
    } else {
      occs.forEach((o, i) =>
        add({
          id: `ALERT:${o.id}`,
          kind: "ALERT",
          at: o.occurredAt,
          title: `${i === 0 ? "Security alert raised" : "Security alert recurred"}: ${o.title} (${lower(o.severity)})`,
          detail: { type: alert.type, severity: o.severity, confidence: alert.confidence },
          evidence: [
            { type: "alert_occurrence", id: o.id },
            { type: "security_alert", id: alert.id },
          ],
          tone: toneForLevel(o.severity),
          trigger: isAnchor && i === 0,
        })
      );
    }
  }

  // --- Reported actions and outcomes ---------------------------------------
  for (const e of bundle.events) {
    const decisionRecord = evalByEventId.get(e.id);
    const isAnchor = incident.anchorType === "ACTIVITY_EVENT" && incident.anchorId === e.id;
    // A decision's own activity event is covered by its DECISION item.
    if (!(e.source === "policy_evaluation" && decisionRecord)) {
      add({
        id: `ACTION:${e.id}`,
        kind: "ACTION",
        at: e.timestamp,
        title: e.source === "policy_evaluation" ? `Agent requested "${e.action}" (its decision is not in this view)` : `Agent reported "${e.action}"`,
        detail: {
          eventType: e.eventType,
          resource: e.resource,
          tool: e.toolName ?? e.toolKey,
          service: e.service,
          destination: e.destination,
          dataClasses: e.dataClasses.length ? e.dataClasses.join(", ") : null,
          dataSensitivity: e.dataSensitivity,
          volume: volume(e),
          status: e.status,
          riskLevel: e.riskLevel,
          task: e.taskId,
        },
        evidence: [{ type: "activity_event", id: e.id }],
        tone: e.status === "BLOCKED" ? "danger" : e.status === "APPROVAL_REQUIRED" || e.status === "FAILED" ? "warning" : "neutral",
        trigger: isAnchor,
      });
    }

    if (e.outcome) {
      const under = e.evaluationId ? evalById.get(e.evaluationId) : undefined;
      const despite = Boolean(under && (under.decision === "BLOCK" || under.decision === "REQUIRE_APPROVAL") && (e.outcome === "SUCCESS" || e.outcome === "WARNING"));
      add({
        id: `OUTCOME:${e.id}`,
        kind: "OUTCOME",
        at: e.timestamp,
        title: `Agent reported ${lower(e.outcome)} for "${e.action}"${despite ? ` although the decision was ${under!.decision}` : ""}`,
        detail: { outcome: e.outcome, ranUnderDecision: under?.decision ?? null, reportedDespiteDecision: despite },
        evidence: [{ type: "activity_event", id: e.id }, ...(under ? [{ type: "policy_evaluation" as const, id: under.id }] : [])],
        tone: despite ? "danger" : e.outcome === "SUCCESS" ? "success" : "warning",
      });
    }
  }

  // --- Decisions, policies, risk, enforcement ------------------------------
  for (const ev of bundle.evaluations) {
    const ref: EvidenceRef = { type: "policy_evaluation", id: ev.id };
    const eventRef: EvidenceRef[] = ev.activityEventId && eventById.has(ev.activityEventId) ? [{ type: "activity_event", id: ev.activityEventId }] : [];
    const isAnchor =
      (incident.anchorType === "POLICY_EVALUATION" && incident.anchorId === ev.id) ||
      (incident.anchorType === "ACTIVITY_EVENT" && ev.activityEventId === incident.anchorId);
    const event = ev.activityEventId ? eventById.get(ev.activityEventId) : undefined;

    add({
      id: `DECISION:${ev.id}`,
      kind: "DECISION",
      at: ev.createdAt,
      title: `Aegis decided ${ev.decision} for "${ev.action}"${ev.decisionSource ? ` (decided by ${sourceLabel[ev.decisionSource] ?? lower(ev.decisionSource)})` : ""}`,
      detail: {
        decision: ev.decision,
        policyAlone: ev.policyDecision,
        decidedBy: ev.decisionSource,
        agentStatus: ev.agentStatus,
        tool: event?.toolName ?? event?.toolKey ?? null,
        destination: event?.destination ?? null,
        dataClasses: event && event.dataClasses.length ? event.dataClasses.join(", ") : null,
        reason: short(ev.reason),
      },
      evidence: [ref, ...eventRef],
      tone: toneForDecision(ev.decision),
      trigger: isAnchor,
    });

    for (const p of ev.matchedPolicies) {
      add({
        id: `POLICY:${ev.id}:${p.id}`,
        kind: "POLICY",
        at: ev.createdAt,
        title: `Policy "${p.name}" matched and resolved to ${p.decision}`,
        detail: { policy: p.name, policyId: p.id, resolvedTo: p.decision },
        evidence: [ref],
        tone: toneForDecision(p.decision),
      });
    }
    if (ev.permission && (ev.matchedPolicies.length === 0 || ev.permission.decision !== "ALLOW")) {
      add({
        id: `POLICY:${ev.id}:permission`,
        kind: "POLICY",
        at: ev.createdAt,
        title: `Agent permission "${ev.permission.action}" resolved to ${ev.permission.decision}`,
        detail: { permission: ev.permission.action, resolvedTo: ev.permission.decision },
        evidence: [ref],
        tone: toneForDecision(ev.permission.decision),
      });
    }
    if (ev.decisionSource === "DEFAULT_DENY") {
      add({
        id: `POLICY:${ev.id}:default-deny`,
        kind: "POLICY",
        at: ev.createdAt,
        title: `No policy or permission covered "${ev.action}", so the default was BLOCK`,
        detail: { decidedBy: "DEFAULT_DENY" },
        evidence: [ref],
        tone: "warning",
      });
    }

    if (ev.riskAssessedLevel) {
      add({
        id: `RISK:${ev.id}`,
        kind: "RISK",
        at: ev.createdAt,
        title: `Risk assessed ${lower(ev.riskAssessedLevel)}${ev.riskSignals.length ? ` (${listOf(ev.riskSignals.map((s) => lower(s.code)), 5)})` : ""}`,
        detail: {
          level: ev.riskAssessedLevel,
          riskEngineRecommended: ev.riskRecommendedDecision,
          riskControl: ev.riskControlOutcome ? `${lower(ev.riskControlOutcome)}${ev.riskControlMode ? ` (${lower(ev.riskControlMode)})` : ""}` : null,
          agentTrust: ev.trust ? `${lower(ev.trust.state)} (${ev.trust.score}/100)` : null,
        },
        evidence: [ref],
        tone: toneForLevel(ev.riskAssessedLevel),
      });
    }

    const approval = approvalByEval.get(ev.id);
    if (ev.decision !== "ALLOW" || ev.decisionSource === "APPROVAL" || ev.riskControlOutcome === "ESCALATED") {
      const title =
        ev.decision === "BLOCK"
          ? "Aegis returned BLOCK to the agent"
          : ev.decision === "REQUIRE_APPROVAL"
            ? `Aegis returned REQUIRE_APPROVAL${approval ? " and opened an approval request" : ""}`
            : ev.decision === "ALERT"
              ? "Aegis returned ALERT: the action was allowed and flagged"
              : "Aegis allowed the action under a consumed human approval";
      add({
        id: `ENFORCEMENT:${ev.id}`,
        kind: "ENFORCEMENT",
        at: ev.createdAt,
        title,
        detail: {
          decision: ev.decision,
          decidedBy: ev.decisionSource,
          riskControlEscalated: ev.riskControlOutcome === "ESCALATED",
          approvalRequest: approval?.id ?? null,
        },
        evidence: [ref, ...(approval ? [{ type: "approval_request" as const, id: approval.id }] : [])],
        tone: toneForDecision(ev.decision),
      });
    }
  }

  // --- Approvals ---------------------------------------------------------------
  for (const a of bundle.approvals) {
    const ref: EvidenceRef = { type: "approval_request", id: a.id };
    add({
      id: `APPROVAL:${a.id}:requested`,
      kind: "APPROVAL",
      at: a.requestedAt,
      title: `Approval requested for "${a.action}"`,
      detail: { approvalRequest: a.id, action: a.action },
      evidence: [ref, ...(evalById.has(a.policyEvaluationId) ? [{ type: "policy_evaluation" as const, id: a.policyEvaluationId }] : [])],
      tone: "warning",
    });
    if (a.resolvedAt && (a.status === "EXPIRED" || a.status === "CANCELLED")) {
      add({ id: `APPROVAL:${a.id}:${a.status.toLowerCase()}`, kind: "APPROVAL", at: a.resolvedAt, title: `Approval request ${lower(a.status)}`, detail: { approvalRequest: a.id }, evidence: [ref], tone: "neutral" });
    }
    if (a.consumedAt) {
      const consumer = a.consumedByEvaluationId && evalById.has(a.consumedByEvaluationId) ? [{ type: "policy_evaluation" as const, id: a.consumedByEvaluationId }] : [];
      add({
        id: `APPROVAL:${a.id}:consumed`,
        kind: "APPROVAL",
        at: a.consumedAt,
        title: "Approval consumed: the approved request was used once",
        detail: { approvalRequest: a.id, consumedByDecision: a.consumedByEvaluationId },
        evidence: [ref, ...consumer],
        tone: "info",
      });
    }
  }
  for (const d of bundle.approvalDecisions) {
    add({
      id: `APPROVAL:${d.approvalRequestId}:decision:${d.id}`,
      kind: "APPROVAL",
      at: d.createdAt,
      title: `${d.decidedByLabel} ${d.decision === "APPROVED" ? "approved" : d.decision === "REJECTED" ? "rejected" : lower(d.decision)} the approval request`,
      detail: { decision: d.decision, decidedBy: d.decidedByLabel, comment: d.comment ? short(d.comment) : null },
      evidence: [
        { type: "approval_decision", id: d.id },
        { type: "approval_request", id: d.approvalRequestId },
      ],
      tone: d.decision === "APPROVED" ? "success" : "warning",
    });
  }

  // --- Behavioral deviations -------------------------------------------------
  for (const d of bundle.deviations) {
    const event = d.eventId ? eventById.get(d.eventId) : undefined;
    add({
      id: `DEVIATION:${d.id}`,
      kind: "DEVIATION",
      at: event ? event.timestamp : d.firstSeenAt,
      title: `Unusual for this agent: ${describeDeviation(d.kind, d.observed, d.confidence)}`,
      detail: { kind: d.kind, confidence: d.confidence, baselineVersion: d.baselineVersion, timesSeen: d.occurrences },
      evidence: [{ type: "behavioral_deviation", id: d.id }, ...(event ? [{ type: "activity_event" as const, id: event.id }] : [])],
      tone: "warning",
    });
  }

  // --- Trust and operator control -------------------------------------------
  for (const t of bundle.trust) {
    add({
      id: `TRUST:${t.id}`,
      kind: "TRUST",
      at: t.occurredAt,
      title: `Agent trust changed ${t.previousState ? lower(t.previousState) : "unrated"} → ${lower(t.newState)} (score ${t.previousScore ?? "–"} → ${t.newScore})`,
      detail: { previousState: t.previousState, newState: t.newState, trigger: t.trigger },
      evidence: [{ type: "trust_transition", id: t.id }],
      tone: t.newState === "RESTRICTED" || t.newState === "HIGH_RISK" ? "danger" : t.newState === "DEGRADED" ? "warning" : "info",
    });
  }
  for (const c of bundle.control) {
    const verb = c.eventType === "agent.paused" ? "paused" : c.eventType === "agent.stopped" ? "stopped" : c.eventType === "agent.resumed" ? "resumed" : lower(c.eventType);
    add({
      id: `CONTROL:${c.id}`,
      kind: "CONTROL",
      at: c.createdAt,
      title: `${c.actorLabel ?? "An operator"} ${verb} the agent`,
      detail: { control: verb, reason: c.reason },
      evidence: [{ type: "audit_event", id: c.id }],
      tone: verb === "resumed" ? "info" : "warning",
    });
  }

  // --- Order, cap -------------------------------------------------------------
  items.sort((a, b) => a.at.getTime() - b.at.getTime() || KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let itemsTruncated = false;
  let shown = items;
  if (items.length > MAX_ITEMS) {
    itemsTruncated = true;
    const trigger = items.find((i) => i.trigger);
    shown = items.slice(0, MAX_ITEMS);
    if (trigger && !shown.includes(trigger)) shown = [...shown.slice(0, MAX_ITEMS - 1), trigger];
  }

  // --- Evidence records ---------------------------------------------------------
  const slug = agent.slug;
  const evidence: EvidenceRecord[] = [
    ...bundle.alerts.map((a): EvidenceRecord => ({
      ref: { type: "security_alert", id: a.id },
      at: a.firstSeenAt,
      label: `Security alert: ${a.title}`,
      href: `/security/${a.id}`,
      data: { type: a.type, severity: a.severity, confidence: a.confidence, description: short(a.description, 600), seenTimes: a.count, firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt, detail: sanitizeContext(a.evidence).value },
    })),
    ...bundle.occurrences.map((o): EvidenceRecord => ({
      ref: { type: "alert_occurrence", id: o.id },
      at: o.occurredAt,
      label: `Alert occurrence: ${o.title}`,
      href: `/security/${o.alertId}`,
      data: { alertId: o.alertId, severity: o.severity, occurredAt: o.occurredAt },
    })),
    ...bundle.events.map((e): EvidenceRecord => ({
      ref: { type: "activity_event", id: e.id },
      at: e.timestamp,
      label: `${e.source === "policy_evaluation" ? "Decision request" : "Reported action"}: ${e.action}`,
      href: `/activity/${e.id}`,
      data: { action: e.action, source: e.source, status: e.status, outcome: e.outcome, tool: e.toolName ?? e.toolKey, service: e.service, destination: e.destination, dataClasses: e.dataClasses, volume: volume(e), parentEventId: e.parentEventId, timestamp: e.timestamp },
    })),
    ...bundle.evaluations.map((ev): EvidenceRecord => ({
      ref: { type: "policy_evaluation", id: ev.id },
      at: ev.createdAt,
      label: `Decision: ${ev.decision} for ${ev.action}`,
      href: `/policies/evaluations/${ev.id}`,
      data: { decision: ev.decision, policyAlone: ev.policyDecision, decidedBy: ev.decisionSource, reason: short(ev.reason, 600), matchedPolicies: ev.matchedPolicies, permission: ev.permission, riskLevel: ev.riskAssessedLevel, riskSignals: ev.riskSignals, riskControl: ev.riskControlOutcome, trust: ev.trust, timestamp: ev.createdAt },
    })),
    ...bundle.approvals.map((a): EvidenceRecord => ({
      ref: { type: "approval_request", id: a.id },
      at: a.requestedAt,
      label: `Approval request for ${a.action}`,
      href: `/approvals/${a.id}`,
      data: { status: a.status, requestedAt: a.requestedAt, resolvedAt: a.resolvedAt, consumedAt: a.consumedAt },
    })),
    ...bundle.approvalDecisions.map((d): EvidenceRecord => ({
      ref: { type: "approval_decision", id: d.id },
      at: d.createdAt,
      label: `Approval ${lower(d.decision)} by ${d.decidedByLabel}`,
      href: `/approvals/${d.approvalRequestId}`,
      data: { decision: d.decision, decidedBy: d.decidedByLabel, comment: d.comment ? short(d.comment) : null, createdAt: d.createdAt },
    })),
    ...bundle.deviations.map((d): EvidenceRecord => ({
      ref: { type: "behavioral_deviation", id: d.id },
      at: d.firstSeenAt,
      label: `Behavioral deviation: ${lower(d.kind)}`,
      href: `/agents/${slug}?tab=behavior`,
      data: { kind: d.kind, confidence: d.confidence, observed: sanitizeContext(d.observed).value, baselineVersion: d.baselineVersion, timesSeen: d.occurrences },
    })),
    ...bundle.trust.map((t): EvidenceRecord => ({
      ref: { type: "trust_transition", id: t.id },
      at: t.occurredAt,
      label: `Trust transition: ${t.previousState ?? "unrated"} → ${t.newState}`,
      href: `/agents/${slug}?tab=trust`,
      data: { previousState: t.previousState, newState: t.newState, previousScore: t.previousScore, newScore: t.newScore, trigger: t.trigger, occurredAt: t.occurredAt },
    })),
    ...bundle.control.map((c): EvidenceRecord => ({
      ref: { type: "audit_event", id: c.id },
      at: c.createdAt,
      label: `Audit: ${c.eventType}`,
      href: null,
      data: { eventType: c.eventType, actor: c.actorLabel, reason: c.reason, createdAt: c.createdAt },
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || (refKey(a.ref) < refKey(b.ref) ? -1 : 1));

  const digest = createHash("sha256")
    .update(evidence.map((r) => refKey(r.ref)).sort().join("\n"))
    .digest("hex");

  // --- Context & severity ----------------------------------------------------------
  const tools = [...new Set(bundle.events.flatMap((e) => (e.toolName ?? e.toolKey ? [(e.toolName ?? e.toolKey)!] : [])))].sort();
  const destinations = [...new Set(bundle.events.flatMap((e) => (e.destination ? [e.destination] : [])))].sort();
  const dataClasses = [...new Set(bundle.events.flatMap((e) => e.dataClasses))].sort();
  const taskIds = [...new Set(bundle.events.flatMap((e) => (e.taskId ? [e.taskId] : [])))].sort();

  let severity: Level = "LOW";
  for (const a of bundle.alerts) severity = maxLevel(severity, a.severity);
  for (const e of bundle.events) severity = maxLevel(severity, e.riskLevel);
  for (const ev of bundle.evaluations) if (ev.riskAssessedLevel) severity = maxLevel(severity, ev.riskAssessedLevel);

  return {
    items: shown,
    evidence,
    summary: buildSummary(bundle, { tools, destinations, dataClasses, evalById, eventById }),
    severity,
    evidenceDigest: digest,
    evidenceCount: evidence.length,
    context: { traceId: incident.traceId, taskIds, tools, destinations, dataClasses },
    truncated: { ...bundle.truncated, items: itemsTruncated },
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(
  b: EvidenceBundle,
  ctx: { tools: string[]; destinations: string[]; dataClasses: string[]; evalById: Map<string, BundleEvaluation>; eventById: Map<string, BundleEvent> }
): IncidentSummary {
  const { incident, agent } = b;
  const who = agent.name;
  const what: Claim[] = [];
  const why: Claim[] = [];
  const aegis: Claim[] = [];
  const gaps: Claim[] = [];
  const evRef = (e: BundleEvaluation): EvidenceRef => ({ type: "policy_evaluation", id: e.id });
  const eventRef = (e: BundleEvent): EvidenceRef => ({ type: "activity_event", id: e.id });

  // ---- WHAT happened --------------------------------------------------------
  const anchorAlert = incident.anchorType === "SECURITY_ALERT" ? b.alerts.find((a) => a.id === incident.anchorId) : undefined;
  const anchorEval =
    incident.anchorType === "POLICY_EVALUATION"
      ? b.evaluations.find((e) => e.id === incident.anchorId)
      : incident.anchorType === "ACTIVITY_EVENT"
        ? b.evaluations.find((e) => e.activityEventId === incident.anchorId)
        : undefined;
  const anchorEvent = incident.anchorType === "ACTIVITY_EVENT" ? b.events.find((e) => e.id === incident.anchorId) : undefined;

  if (anchorAlert) {
    what.push(claim(`Security alert "${anchorAlert.title}" (${lower(anchorAlert.severity)}) was raised for ${who}.`, [{ type: "security_alert", id: anchorAlert.id }]));
  } else if (anchorEval) {
    what.push(claim(`${who} requested "${anchorEval.action}" and Aegis decided ${anchorEval.decision}.`, [evRef(anchorEval)]));
  } else if (anchorEvent) {
    what.push(claim(`${who} reported "${anchorEvent.action}"${anchorEvent.outcome ? ` (${lower(anchorEvent.outcome)})` : ""}.`, [eventRef(anchorEvent)]));
  } else {
    gaps.push(claim("The record that opened this incident could not be retrieved, so the trigger is not shown.", []));
  }

  const reported = b.events.filter((e) => e.source !== "policy_evaluation");
  const requests = b.evaluations;
  if (requests.length + reported.length > 0) {
    const parts: string[] = [];
    if (requests.length) parts.push(`made ${plural(requests.length, "authorization request")}`);
    if (reported.length) parts.push(`reported ${plural(reported.length, "action")}`);
    let text = `In this run ${who} ${parts.join(" and ")}`;
    const extras: string[] = [];
    if (ctx.tools.length) extras.push(`using ${listOf(ctx.tools)}`);
    if (ctx.destinations.length) extras.push(`reaching ${listOf(ctx.destinations)}`);
    if (extras.length) text += `, ${extras.join(" and ")}`;
    what.push(claim(`${text}.`, [...requests.map(evRef), ...reported.map(eventRef)]));
  }

  if (ctx.dataClasses.length) {
    const rank = (s: string | null) => (s ? ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(s) : -1);
    const highest = b.events.reduce<string | null>((acc, e) => (rank(e.dataSensitivity) > rank(acc) ? e.dataSensitivity : acc), null);
    what.push(
      claim(
        `Data involved: ${ctx.dataClasses.join(", ")}${highest ? ` (highest reported sensitivity ${lower(highest)})` : ""}.`,
        b.events.filter((e) => e.dataClasses.length).map(eventRef)
      )
    );
  }
  const sizable = b.events.filter((e) => e.recordCount !== null).sort((x, y) => (y.recordCount ?? 0) - (x.recordCount ?? 0))[0];
  if (sizable && (sizable.recordCount ?? 0) > 0) {
    what.push(claim(`Largest single volume reported: ${fmt(sizable.recordCount ?? 0)} records.`, [eventRef(sizable)]));
  }

  // ---- WHY ------------------------------------------------------------------
  if (anchorAlert) {
    why.push(claim(`Detector finding: ${short(anchorAlert.description, 400)}`, [{ type: "security_alert", id: anchorAlert.id }]));
  }

  const confRank: Record<string, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };
  const devs = [...b.deviations].sort((x, y) => (confRank[y.confidence] ?? 0) - (confRank[x.confidence] ?? 0) || x.firstSeenAt.getTime() - y.firstSeenAt.getTime() || (x.id < y.id ? -1 : 1));
  for (const d of devs.slice(0, 5)) {
    why.push(
      claim(`Behavioral deviation from the agent's baseline: ${describeDeviation(d.kind, d.observed, d.confidence)}.`, [
        { type: "behavioral_deviation", id: d.id },
        ...(d.eventId && ctx.eventById.has(d.eventId) ? [{ type: "activity_event" as const, id: d.eventId }] : []),
      ])
    );
  }
  if (devs.length > 5) why.push(claim(`${plural(devs.length - 5, "more behavioral deviation")} recorded for this run.`, devs.slice(5).map((d) => ({ type: "behavioral_deviation" as const, id: d.id }))));

  const byPolicy = new Map<string, { name: string; decisions: Set<string>; evals: BundleEvaluation[] }>();
  for (const ev of b.evaluations) {
    for (const p of ev.matchedPolicies) {
      const entry = byPolicy.get(p.id) ?? { name: p.name, decisions: new Set<string>(), evals: [] };
      entry.decisions.add(p.decision);
      entry.evals.push(ev);
      byPolicy.set(p.id, entry);
    }
  }
  for (const [, entry] of [...byPolicy.entries()].sort((x, y) => (x[1].name < y[1].name ? -1 : 1))) {
    why.push(claim(`Policy "${entry.name}" matched and resolved to ${[...entry.decisions].join("/")} (${plural(entry.evals.length, "decision")}).`, entry.evals.map(evRef)));
  }
  const denied = b.evaluations.filter((e) => e.decisionSource === "DEFAULT_DENY");
  if (denied.length) why.push(claim(`No policy or permission covered ${listOf(denied.map((e) => `"${e.action}"`))}, so Aegis's default was BLOCK.`, denied.map(evRef)));
  const halted = b.evaluations.filter((e) => e.decisionSource === "CONTROL");
  if (halted.length) why.push(claim(`The agent was ${lower(halted[0].agentStatus ?? "halted")} when it asked, so the kill switch decided.`, halted.map(evRef)));

  const assessed = b.evaluations.filter((e) => e.riskAssessedLevel);
  if (assessed.length) {
    const top = assessed.reduce<Level>((acc, e) => maxLevel(acc, e.riskAssessedLevel as Level), "LOW");
    const codes = new Map<string, number>();
    for (const e of assessed) for (const s of e.riskSignals) codes.set(s.code, (codes.get(s.code) ?? 0) + 1);
    const topCodes = [...codes.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 4).map(([c]) => lower(c));
    why.push(claim(`Risk was assessed ${lower(top)} at its highest across ${plural(assessed.length, "decision")}${topCodes.length ? ` (signals: ${listOf(topCodes, 4)})` : ""}.`, assessed.map(evRef)));
    const stricter = assessed.filter((e) => e.riskRecommendedDecision && (STRICTNESS[e.riskRecommendedDecision] ?? 0) > (STRICTNESS[e.decision] ?? 0));
    if (stricter.length) why.push(claim(`Aegis's risk engine recommended a stricter decision than the one returned for ${plural(stricter.length, "request")}.`, stricter.map(evRef)));
  }

  if (b.trust.length) {
    for (const t of b.trust.slice(0, 3)) {
      why.push(claim(`Agent trust changed ${t.previousState ? lower(t.previousState) : "unrated"} to ${lower(t.newState)} (score ${t.previousScore ?? "unknown"} to ${t.newScore}).`, [{ type: "trust_transition", id: t.id }]));
    }
  } else {
    const withTrust = b.evaluations.find((e) => e.trust);
    if (withTrust?.trust) why.push(claim(`At decision time the agent's trust was ${lower(withTrust.trust.state)} (${withTrust.trust.score}/100).`, [evRef(withTrust)]));
  }

  // ---- WHAT AEGIS DID -------------------------------------------------------
  if (b.evaluations.length) {
    const tally = new Map<string, BundleEvaluation[]>();
    for (const ev of b.evaluations) tally.set(ev.decision, [...(tally.get(ev.decision) ?? []), ev]);
    const parts = ["BLOCK", "REQUIRE_APPROVAL", "ALERT", "ALLOW"].flatMap((d) => (tally.has(d) ? [`${fmt(tally.get(d)!.length)} ${d}`] : []));
    aegis.push(claim(`Aegis returned ${listOf(parts, 4)} decision${b.evaluations.length === 1 ? "" : "s"}.`, b.evaluations.map(evRef)));
    const blocks = b.evaluations.filter((e) => e.decision === "BLOCK").slice(0, 3);
    for (const e of blocks) {
      aegis.push(claim(`Aegis returned BLOCK for "${e.action}"${e.decisionSource ? ` (decided by ${sourceLabel[e.decisionSource] ?? lower(e.decisionSource)})` : ""}.`, [evRef(e)]));
    }
    const escalated = b.evaluations.filter((e) => e.riskControlOutcome === "ESCALATED");
    if (escalated.length) aegis.push(claim(`Risk control made ${plural(escalated.length, "decision")} stricter than policy alone.`, escalated.map(evRef)));
  }
  if (b.approvals.length) {
    const c = (s: string) => b.approvals.filter((a) => a.status === s).length;
    const parts = [`${c("APPROVED")} approved`, `${c("REJECTED")} rejected`, `${c("PENDING")} pending`, `${c("EXPIRED")} expired`, `${c("CANCELLED")} cancelled`].filter((p) => !p.startsWith("0 "));
    const consumed = b.approvals.filter((a) => a.consumedAt).length;
    aegis.push(
      claim(
        `${plural(b.approvals.length, "approval request")}: ${parts.join(", ") || "no state recorded"}${consumed ? `; ${consumed} used` : ""}.`,
        [...b.approvals.map((a) => ({ type: "approval_request" as const, id: a.id })), ...b.approvalDecisions.map((d) => ({ type: "approval_decision" as const, id: d.id }))]
      )
    );
  }
  for (const c of b.control.slice(0, 3)) {
    aegis.push(claim(`${c.actorLabel ?? "An operator"} ${c.eventType === "agent.paused" ? "paused" : c.eventType === "agent.stopped" ? "stopped" : c.eventType === "agent.resumed" ? "resumed" : lower(c.eventType)} the agent.`, [{ type: "audit_event", id: c.id }]));
  }
  if (b.alerts.length) {
    aegis.push(claim(`${plural(b.alerts.length, "security alert")} ${b.alerts.length === 1 ? "was" : "were"} raised: ${listOf(b.alerts.map((a) => `"${a.title}"`), 3)}.`, b.alerts.map((a) => ({ type: "security_alert" as const, id: a.id }))));
  }

  // What the agent then reported — Aegis returns decisions; it can't observe execution itself.
  const outcomes = reported.filter((e) => e.outcome);
  if (outcomes.length) {
    const count = (o: string) => outcomes.filter((e) => e.outcome === o).length;
    const parts = [`${count("SUCCESS")} succeeded`, `${count("FAILURE")} failed`, `${count("BLOCKED")} blocked`, `${count("WARNING")} warned`].filter((p) => !p.startsWith("0 "));
    aegis.push(claim(`The agent reported ${plural(outcomes.length, "execution")}: ${parts.join(", ")}.`, outcomes.map(eventRef)));
  }
  const despite = outcomes.filter((e) => {
    const under = e.evaluationId ? ctx.evalById.get(e.evaluationId) : undefined;
    return under && (under.decision === "BLOCK" || under.decision === "REQUIRE_APPROVAL") && (e.outcome === "SUCCESS" || e.outcome === "WARNING");
  });
  if (despite.length) {
    aegis.push(
      claim(
        `${plural(despite.length, "execution")} ${despite.length === 1 ? "was" : "were"} reported as completed although the decision was BLOCK or REQUIRE_APPROVAL. Aegis returns decisions; it cannot stop an integration that does not honor them.`,
        despite.flatMap((e) => [eventRef(e), ...(e.evaluationId && ctx.evalById.has(e.evaluationId) ? [{ type: "policy_evaluation" as const, id: e.evaluationId }] : [])])
      )
    );
  }

  // ---- GAPS: stated as plainly as the facts ---------------------------------------
  if (!incident.traceId) {
    gaps.push(claim("This incident's trigger carries no trace id, so related activity cannot be linked to it; only the triggering record is shown.", []));
  }
  if (reported.length > 0 && b.evaluations.length === 0) {
    gaps.push(claim("No authorization request (decision) is recorded for this run, so Aegis had no opportunity to decide on the reported actions.", reported.map(eventRef)));
  }
  const unassessed = b.evaluations.filter((e) => !e.riskAssessedLevel);
  if (b.evaluations.length > 0 && unassessed.length > 0) {
    gaps.push(claim(`${plural(unassessed.length, "decision")} ${unassessed.length === 1 ? "has" : "have"} no risk assessment recorded (made before the risk engine existed, or it was unavailable).`, unassessed.map(evRef)));
  }
  const present = new Set(b.events.map((e) => e.id));
  const dangling = b.events.filter((e) => e.parentEventId && !present.has(e.parentEventId));
  if (dangling.length) gaps.push(claim(`${plural(dangling.length, "event")} refer${dangling.length === 1 ? "s" : ""} to a parent event that is not part of this evidence.`, dangling.map(eventRef)));
  if (b.truncated.events) gaps.push(claim("This run has more activity than is shown here; the earliest events are shown. The action graph has the full run.", []));
  if (b.truncated.evaluations) gaps.push(claim("This run has more decisions than are shown here; the earliest are shown.", []));
  if (b.truncated.alerts) gaps.push(claim("More security alerts exist for this run than are shown here.", []));
  if (b.truncated.deviations) gaps.push(claim("More behavioral deviations exist for this run than are shown here.", []));

  // ---- Headline and paragraph -----------------------------------------------------
  const paragraphParts = [
    what[0],
    what.find((c) => c.text.startsWith("Data involved")),
    why.find((c) => c.text.startsWith("Behavioral deviation")),
    why.find((c) => c.text.startsWith("Policy ")),
    aegis.find((c) => c.text.startsWith("Aegis returned BLOCK")) ?? aegis[0],
    aegis.find((c) => c.text.includes("although the decision was")),
  ].filter((c): c is Claim => Boolean(c));
  const paragraph = [...new Set(paragraphParts.map((c) => c.text))].join(" ") || "There is not enough stored evidence to say what happened.";
  const headline = what[0]?.text ?? `Incident ${incident.number} for ${who}`;

  return { headline, paragraph, what, why, aegis, gaps };
}
