import "server-only";

import { Prisma, type Incident, type IncidentStatus, type PolicyDecision, type RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { loadEvidenceBundle } from "@/lib/incidents/evidence";
import { reconstructIncident } from "@/lib/incidents/reconstruct";
import {
  IncidentNotFoundError,
  IncidentTransitionError,
  assertCanManage,
  assertCanView,
  type IncidentActor,
} from "@/lib/incidents/authorization";
import { CLOSED_STATUSES, MAX_NOTE_LENGTH, checkTransition } from "@/lib/incidents/status";
import type { AnchorType, Level, Reconstruction } from "@/lib/incidents/types";

/**
 * Incident handling. An incident is a thin handle on stored evidence; every
 * function here is tenant-scoped (organizationId is part of every query and
 * comes from the authenticated actor, never from input), authorizes the actor
 * itself, and none of them can modify or delete the evidence an incident
 * describes — there is no such code path. Handling state (status,
 * acknowledgement) lives on the incident; each change is also an append-only
 * IncidentActivity row.
 */

const LEVELS: readonly Level[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const maxLevel = (a: Level, b: Level): Level => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);

const AUDIT = {
  OPENED: AUDIT_EVENT_TYPES.INCIDENT_OPENED,
  ACKNOWLEDGED: AUDIT_EVENT_TYPES.INCIDENT_ACKNOWLEDGED,
  STATUS: AUDIT_EVENT_TYPES.INCIDENT_STATUS_CHANGED,
} as const;

// -- Opening -----------------------------------------------------------------

type ResolvedAnchor = {
  agentId: string;
  anchorType: AnchorType;
  anchorId: string;
  traceId: string | null;
  title: string;
  severity: Level;
};

const clusterKeyOf = (a: Pick<ResolvedAnchor, "traceId" | "anchorType" | "anchorId">) =>
  a.traceId ? `trace:${a.traceId}` : `${a.anchorType.toLowerCase()}:${a.anchorId}`;

/** Loads the trigger record — in THIS organization only — and describes it. Null if it does not exist for the tenant. */
async function resolveAnchor(organizationId: string, anchorType: AnchorType, anchorId: string): Promise<ResolvedAnchor | null> {
  if (anchorType === "SECURITY_ALERT") {
    const a = await prisma.securityAlert.findFirst({ where: { id: anchorId, organizationId }, select: { id: true, agentId: true, title: true, severity: true, traceId: true } });
    return a ? { agentId: a.agentId, anchorType, anchorId: a.id, traceId: a.traceId, title: a.title, severity: a.severity as Level } : null;
  }
  if (anchorType === "POLICY_EVALUATION") {
    const e = await prisma.policyEvaluation.findFirst({
      where: { id: anchorId, organizationId },
      select: { id: true, agentId: true, action: true, decision: true, traceId: true, riskAssessedLevel: true, activityEvent: { select: { riskLevel: true } } },
    });
    if (!e) return null;
    const severity = maxLevel((e.riskAssessedLevel as Level | null) ?? "LOW", (e.activityEvent?.riskLevel as Level | undefined) ?? "LOW");
    return { agentId: e.agentId, anchorType, anchorId: e.id, traceId: e.traceId, title: `${e.decision.replaceAll("_", " ")} decision for "${e.action}"`, severity };
  }
  const ev = await prisma.activityEvent.findFirst({ where: { id: anchorId, organizationId }, select: { id: true, agentId: true, action: true, traceId: true, riskLevel: true } });
  return ev ? { agentId: ev.agentId, anchorType, anchorId: ev.id, traceId: ev.traceId, title: `Activity: ${ev.action}`, severity: ev.riskLevel as Level } : null;
}

type UpsertResult = { incident: Incident; created: boolean };

async function upsertIncident(params: { organizationId: string; anchor: ResolvedAnchor; openedVia: "ALERT_TRIGGER" | "MANUAL"; userId?: string }): Promise<UpsertResult> {
  const { organizationId, anchor } = params;
  const clusterKey = clusterKeyOf(anchor);
  return prisma.$transaction(async (tx) => {
    // One lock per organization serializes creation, so numbers are gapless and
    // two concurrent triggers for the same run cannot both create an incident.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`incident:${organizationId}`}))`;
    const existing = await tx.incident.findUnique({ where: { organizationId_agentId_clusterKey: { organizationId, agentId: anchor.agentId, clusterKey } } });
    if (existing) return { incident: existing, created: false };

    const last = await tx.incident.aggregate({ where: { organizationId }, _max: { number: true } });
    const incident = await tx.incident.create({
      data: {
        organizationId,
        agentId: anchor.agentId,
        number: (last._max.number ?? 0) + 1,
        clusterKey,
        anchorType: anchor.anchorType,
        anchorId: anchor.anchorId,
        traceId: anchor.traceId,
        title: anchor.title.slice(0, 300),
        severity: anchor.severity as RiskLevel,
        openedVia: params.openedVia,
        openedByUserId: params.userId ?? null,
      },
    });
    await tx.incidentActivity.create({
      data: {
        organizationId,
        incidentId: incident.id,
        kind: "OPENED",
        toStatus: "OPEN",
        actorUserId: params.userId ?? null,
        note: params.openedVia === "ALERT_TRIGGER" ? "Opened automatically when a security alert was raised." : "Opened by an operator.",
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorType: params.userId ? "USER" : "SYSTEM",
      actorUserId: params.userId,
      agentId: anchor.agentId,
      eventType: AUDIT.OPENED,
      entityType: "Incident",
      entityId: incident.id,
      action: "incident.open",
      metadata: { number: incident.number, anchorType: anchor.anchorType, anchorId: anchor.anchorId, via: params.openedVia },
      traceId: anchor.traceId ?? undefined,
    });
    return { incident, created: true };
  });
}

/**
 * Called when a security alert has just been CREATED (not when an existing one
 * recurs). Opens the run's incident, or — if one exists — raises its severity
 * and reopens it if it had been closed, since a new alert is new evidence.
 * System action: no actor, nothing about the alert changes.
 */
export async function ensureIncidentForAlert(
  organizationId: string,
  alert: { id: string; agentId: string; title: string; severity: string; traceId: string | null }
): Promise<UpsertResult> {
  const anchor: ResolvedAnchor = {
    agentId: alert.agentId,
    anchorType: "SECURITY_ALERT",
    anchorId: alert.id,
    traceId: alert.traceId,
    title: alert.title,
    severity: alert.severity as Level,
  };
  const result = await upsertIncident({ organizationId, anchor, openedVia: "ALERT_TRIGGER" });
  if (result.created) return result;

  const incident = result.incident;
  if (LEVELS.indexOf(alert.severity as Level) > LEVELS.indexOf(incident.severity as Level)) {
    await prisma.incident.updateMany({ where: { id: incident.id, organizationId, severity: incident.severity }, data: { severity: alert.severity as RiskLevel } });
  }
  if (CLOSED_STATUSES.includes(incident.status)) {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.incident.updateMany({ where: { id: incident.id, organizationId, status: incident.status }, data: { status: "OPEN", statusChangedAt: new Date() } });
      if (moved.count === 1) {
        await tx.incidentActivity.create({
          data: {
            organizationId,
            incidentId: incident.id,
            kind: "STATUS_CHANGED",
            fromStatus: incident.status,
            toStatus: "OPEN",
            actorUserId: null,
            note: "Reopened automatically: a new security alert was raised for this run.",
          },
        });
      }
    });
  }
  return result;
}

/** Opens (or returns) the incident for a trigger an operator is looking at. Manage capability required. */
export async function openIncident(actor: IncidentActor, input: { anchorType: AnchorType; anchorId: string }) {
  assertCanManage(actor);
  const anchor = await resolveAnchor(actor.organizationId, input.anchorType, input.anchorId);
  if (!anchor) throw new IncidentNotFoundError();
  return upsertIncident({ organizationId: actor.organizationId, anchor, openedVia: "MANUAL", userId: actor.userId });
}

// -- Reading -----------------------------------------------------------------

async function findIncident(organizationId: string, id: string) {
  return prisma.incident.findFirst({ where: { id, organizationId }, include: { agent: { select: { id: true, name: true, slug: true } } } });
}

export type IncidentActivityView = {
  id: string;
  kind: string;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  actor: string | null;
  note: string | null;
  createdAt: Date;
  evidenceCount: number | null;
};

export type IncidentView = {
  incident: NonNullable<Awaited<ReturnType<typeof findIncident>>> & { acknowledgedBy: string | null; openedBy: string | null };
  reconstruction: Reconstruction;
  activity: IncidentActivityView[];
  /** Evidence added since the incident's status was last set (digest comparison); null if never recorded. */
  evidenceSinceLastChange: { added: number } | null;
};

export async function getIncidentView(actor: IncidentActor, id: string): Promise<IncidentView> {
  assertCanView(actor);
  const incident = await findIncident(actor.organizationId, id);
  if (!incident) throw new IncidentNotFoundError();

  const bundle = await loadEvidenceBundle(incident);
  if (!bundle) throw new IncidentNotFoundError();
  const reconstruction = reconstructIncident(bundle);

  const activity = await prisma.incidentActivity.findMany({ where: { incidentId: incident.id, organizationId: actor.organizationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const userIds = [...new Set([...activity.flatMap((a) => (a.actorUserId ? [a.actorUserId] : [])), ...(incident.acknowledgedById ? [incident.acknowledgedById] : []), ...(incident.openedByUserId ? [incident.openedByUserId] : [])])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = (userId: string | null) => {
    if (!userId) return null;
    const u = users.find((x) => x.id === userId);
    return u ? (u.name ?? u.email) : "a former member";
  };

  const lastWithDigest = [...activity].reverse().find((a) => a.evidenceDigest && a.kind === "STATUS_CHANGED");
  const evidenceSinceLastChange =
    lastWithDigest && lastWithDigest.evidenceDigest !== reconstruction.evidenceDigest ? { added: Math.max(reconstruction.evidenceCount - (lastWithDigest.evidenceCount ?? 0), 0) } : null;

  return {
    incident: { ...incident, acknowledgedBy: nameOf(incident.acknowledgedById), openedBy: nameOf(incident.openedByUserId) },
    reconstruction,
    activity: activity.map((a) => ({
      id: a.id,
      kind: a.kind,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      actor: a.actorUserId ? nameOf(a.actorUserId) : "Aegis (automatic)",
      note: a.note,
      createdAt: a.createdAt,
      evidenceCount: a.evidenceCount,
    })),
    evidenceSinceLastChange,
  };
}

// -- Handling ------------------------------------------------------------------

async function currentEvidence(incident: Incident) {
  const bundle = await loadEvidenceBundle(incident);
  if (!bundle) return { digest: null, count: null };
  const r = reconstructIncident(bundle);
  return { digest: r.evidenceDigest, count: r.evidenceCount };
}

/** Acknowledge: "a human has seen this." Idempotent — the first acknowledgement wins, later ones change nothing. Never touches the security record. */
export async function acknowledgeIncident(actor: IncidentActor, id: string): Promise<{ acknowledged: boolean }> {
  assertCanManage(actor);
  const incident = await findIncident(actor.organizationId, id);
  if (!incident) throw new IncidentNotFoundError();
  const evidence = await currentEvidence(incident);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.incident.updateMany({ where: { id, organizationId: actor.organizationId, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: actor.userId } });
    if (claimed.count === 0) return { acknowledged: false };
    await tx.incidentActivity.create({
      data: { organizationId: actor.organizationId, incidentId: id, kind: "ACKNOWLEDGED", actorUserId: actor.userId, evidenceDigest: evidence.digest, evidenceCount: evidence.count },
    });
    await recordAuditEvent(tx, { organizationId: actor.organizationId, actorType: "USER", actorUserId: actor.userId, agentId: incident.agentId, eventType: AUDIT.ACKNOWLEDGED, entityType: "Incident", entityId: id, action: "incident.acknowledge", metadata: { number: incident.number } });
    return { acknowledged: true };
  });
}

/**
 * Change handling status (see lib/incidents/status.ts for the allowed moves).
 * Compare-and-set on the status the caller saw: if another operator moved it
 * first, this fails with CONFLICT instead of silently overwriting their move.
 */
export async function changeIncidentStatus(actor: IncidentActor, id: string, to: IncidentStatus, note?: string): Promise<{ from: IncidentStatus; to: IncidentStatus }> {
  assertCanManage(actor);
  const incident = await findIncident(actor.organizationId, id);
  if (!incident) throw new IncidentNotFoundError();
  const check = checkTransition(incident.status, to, note);
  if (!check.ok) throw new IncidentTransitionError(check.code, check.message);
  const evidence = await currentEvidence(incident);
  const from = incident.status;

  await prisma.$transaction(async (tx) => {
    const moved = await tx.incident.updateMany({ where: { id, organizationId: actor.organizationId, status: from }, data: { status: to, statusChangedAt: new Date() } });
    if (moved.count !== 1) throw new IncidentTransitionError("CONFLICT", "Someone else changed this incident's status first. Reload and try again.");
    await tx.incidentActivity.create({
      data: { organizationId: actor.organizationId, incidentId: id, kind: "STATUS_CHANGED", fromStatus: from, toStatus: to, actorUserId: actor.userId, note: note?.trim() || null, evidenceDigest: evidence.digest, evidenceCount: evidence.count },
    });
    await recordAuditEvent(tx, { organizationId: actor.organizationId, actorType: "USER", actorUserId: actor.userId, agentId: incident.agentId, eventType: AUDIT.STATUS, entityType: "Incident", entityId: id, action: "incident.status", metadata: { number: incident.number, from, to } });
  });
  return { from, to };
}

export async function addIncidentNote(actor: IncidentActor, id: string, note: string): Promise<void> {
  assertCanManage(actor);
  const trimmed = note.trim();
  if (!trimmed) throw new IncidentTransitionError("EMPTY_NOTE", "A note cannot be empty.");
  if (trimmed.length > MAX_NOTE_LENGTH) throw new IncidentTransitionError("NOTE_TOO_LONG", `Notes are limited to ${MAX_NOTE_LENGTH} characters.`);
  const incident = await findIncident(actor.organizationId, id);
  if (!incident) throw new IncidentNotFoundError();
  await prisma.incidentActivity.create({ data: { organizationId: actor.organizationId, incidentId: id, kind: "NOTE", actorUserId: actor.userId, note: trimmed } });
}

// -- Search ----------------------------------------------------------------------

export type IncidentFilters = {
  status?: IncidentStatus[];
  agentId?: string;
  severity?: RiskLevel[];
  from?: Date;
  to?: Date;
  /** An incident whose run contains a decision that matched this policy. */
  policyId?: string;
  /** An incident whose run contains a decision with this outcome. */
  decision?: PolicyDecision;
  /** Exact host the run's events reached (lower-case). */
  destination?: string;
  /** Exact normalized tool key the run's events used. */
  tool?: string;
  acknowledged?: boolean;
  page?: number;
  pageSize?: number;
};

export const INCIDENT_PAGE_SIZE = 25;

export async function searchIncidents(actor: IncidentActor, filters: IncidentFilters = {}) {
  assertCanView(actor);
  const organizationId = actor.organizationId;
  const pageSize = Math.min(Math.max(filters.pageSize ?? INCIDENT_PAGE_SIZE, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  // Tenant first, always; every other condition only narrows it.
  const where: Prisma.Sql[] = [Prisma.sql`i."organizationId" = ${organizationId}`];
  if (filters.status?.length) where.push(Prisma.sql`i."status"::text IN (${Prisma.join(filters.status)})`);
  if (filters.severity?.length) where.push(Prisma.sql`i."severity"::text IN (${Prisma.join(filters.severity)})`);
  if (filters.agentId) where.push(Prisma.sql`i."agentId" = ${filters.agentId}`);
  if (filters.from) where.push(Prisma.sql`i."openedAt" >= ${filters.from.toISOString()}::timestamp`);
  if (filters.to) where.push(Prisma.sql`i."openedAt" <= ${filters.to.toISOString()}::timestamp`);
  if (filters.acknowledged === true) where.push(Prisma.sql`i."acknowledgedAt" IS NOT NULL`);
  if (filters.acknowledged === false) where.push(Prisma.sql`i."acknowledgedAt" IS NULL`);

  // Evidence filters look inside the incident's own run (same organization AND agent) or at its trigger.
  if (filters.policyId || filters.decision) {
    const inner: Prisma.Sql[] = [];
    if (filters.policyId) inner.push(Prisma.sql`${filters.policyId} = ANY(pe."matchedPolicyIds")`);
    if (filters.decision) inner.push(Prisma.sql`pe."decision"::text = ${filters.decision}`);
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "policy_evaluations" pe
       WHERE pe."organizationId" = i."organizationId" AND pe."agentId" = i."agentId"
         AND ((i."traceId" IS NOT NULL AND pe."traceId" = i."traceId") OR (i."anchorType" = 'POLICY_EVALUATION' AND pe."id" = i."anchorId"))
         AND ${Prisma.join(inner, " AND ")})`);
  }
  if (filters.destination || filters.tool) {
    const inner: Prisma.Sql[] = [];
    if (filters.destination) inner.push(Prisma.sql`ae."destination" = ${filters.destination.toLowerCase()}`);
    if (filters.tool) inner.push(Prisma.sql`ae."toolKey" = ${filters.tool.toLowerCase()}`);
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "activity_events" ae
       WHERE ae."organizationId" = i."organizationId" AND ae."agentId" = i."agentId"
         AND ((i."traceId" IS NOT NULL AND ae."traceId" = i."traceId") OR (i."anchorType" = 'ACTIVITY_EVENT' AND ae."id" = i."anchorId"))
         AND ${Prisma.join(inner, " AND ")})`);
  }
  const condition = Prisma.join(where, " AND ");

  const [idRows, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT i."id" FROM "incidents" i WHERE ${condition}
       ORDER BY i."openedAt" DESC, i."id" DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "incidents" i WHERE ${condition}`,
  ]);
  const ids = idRows.map((r) => r.id);
  const rows = ids.length
    ? await prisma.incident.findMany({ where: { id: { in: ids }, organizationId }, include: { agent: { select: { id: true, name: true, slug: true } } } })
    : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const total = Number(countRows[0]?.n ?? 0);
  return { incidents: rows, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Counts by status for the list header — tenant-scoped. */
export async function incidentStatusCounts(actor: IncidentActor) {
  assertCanView(actor);
  const groups = await prisma.incident.groupBy({ by: ["status"], where: { organizationId: actor.organizationId }, _count: { _all: true } });
  const counts: Record<IncidentStatus, number> = { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, FALSE_POSITIVE: 0 };
  for (const g of groups) counts[g.status] = g._count._all;
  return counts;
}
