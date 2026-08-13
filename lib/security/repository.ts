import "server-only";

import type { Prisma, SecurityAlertSeverity, SecurityAlertStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import type { Finding } from "@/lib/security/types";
import { SecurityAlertAlreadyResolvedError, SecurityAlertNotFoundError } from "@/lib/security/types";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const ALERT_INCLUDE = {
  agent: { select: { id: true, name: true, slug: true, riskLevel: true, status: true } },
  acknowledgedByUser: { select: { id: true, name: true, email: true } },
  resolvedByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SecurityAlertInclude;

/**
 * Persists a detector Finding with dedup: a repeat trigger of the same
 * (agentId, type) against an OPEN alert from the last 24h bumps
 * count/lastSeenAt/evidence instead of creating a new row — spec §6's
 * "avoid alert spam." Only a genuinely new alert is audit-logged; dedup
 * updates are not, so acknowledging/resolving one alert's audit trail
 * stays readable instead of one line per repeat trigger.
 */
export async function upsertAlertFinding(
  organizationId: string,
  finding: Finding
): Promise<{ created: boolean; alert: Prisma.SecurityAlertGetPayload<{ include: typeof ALERT_INCLUDE }> }> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const redactedEvidence = redactSecrets(finding.evidence) as Prisma.InputJsonValue;

  const existing = await prisma.securityAlert.findFirst({
    where: { organizationId, agentId: finding.agentId, type: finding.type, status: "OPEN", firstSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
  });

  if (existing) {
    const updated = await prisma.securityAlert.update({
      where: { id: existing.id },
      data: { count: { increment: 1 }, lastSeenAt: new Date(), evidence: redactedEvidence, severity: finding.severity },
      include: ALERT_INCLUDE,
    });
    return { created: false, alert: updated };
  }

  const created = await prisma.securityAlert.create({
    data: {
      organizationId,
      agentId: finding.agentId,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      evidence: redactedEvidence,
      traceId: finding.traceId ?? undefined,
    },
    include: ALERT_INCLUDE,
  });

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "SYSTEM",
    agentId: finding.agentId,
    eventType: AUDIT_EVENT_TYPES.SECURITY_ALERT_CREATED,
    entityType: "SecurityAlert",
    entityId: created.id,
    action: finding.type,
    metadata: { severity: finding.severity, title: finding.title },
    traceId: finding.traceId,
  });

  const webhookPayload = {
    id: created.id,
    type: created.type,
    severity: created.severity,
    title: created.title,
    agentId: created.agentId,
    traceId: created.traceId,
  };
  await dispatchWebhookEvent(organizationId, "security.alert.created", webhookPayload);
  if (finding.type === SECURITY_ALERT_TYPES.COST_SPIKE) {
    await dispatchWebhookEvent(organizationId, "cost.anomaly.detected", { ...webhookPayload, evidence: finding.evidence });
  }

  return { created: true, alert: created };
}

export type SecurityAlertFilters = {
  status?: SecurityAlertStatus;
  severity?: SecurityAlertSeverity;
  agentId?: string;
  type?: string;
  page: number;
};

const ALERT_PAGE_SIZE = 20;

/** Defaults to OPEN when no status filter is given — same "actionable subset first" convention as /approvals. */
export async function listSecurityAlerts(organizationId: string, filters: SecurityAlertFilters) {
  const where: Prisma.SecurityAlertWhereInput = {
    organizationId,
    status: filters.status ?? "OPEN",
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  const [alerts, total] = await Promise.all([
    prisma.securityAlert.findMany({
      where,
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
      skip: (filters.page - 1) * ALERT_PAGE_SIZE,
      take: ALERT_PAGE_SIZE,
    }),
    prisma.securityAlert.count({ where }),
  ]);

  return { alerts, total, pageCount: Math.max(1, Math.ceil(total / ALERT_PAGE_SIZE)), pageSize: ALERT_PAGE_SIZE };
}

export async function getSecurityAlert(organizationId: string, id: string) {
  return prisma.securityAlert.findFirst({ where: { id, organizationId }, include: ALERT_INCLUDE });
}

export async function listSecurityAlertsForAgent(organizationId: string, agentId: string, limit = 10) {
  return prisma.securityAlert.findMany({
    where: { organizationId, agentId },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
    take: limit,
  });
}

/** Used by /costs to list cost anomalies — a COST_SPIKE alert is just another SecurityAlert, not a separate model. */
export async function listSecurityAlertsByType(organizationId: string, type: string, limit = 10) {
  return prisma.securityAlert.findMany({
    where: { organizationId, type },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
  });
}

export async function getSecurityStatsForAgent(organizationId: string, agentId: string) {
  const [open, highOrCritical, costAnomaly] = await Promise.all([
    prisma.securityAlert.count({ where: { organizationId, agentId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.securityAlert.count({
      where: { organizationId, agentId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: { in: ["HIGH", "CRITICAL"] } },
    }),
    prisma.securityAlert.findFirst({
      where: { organizationId, agentId, type: SECURITY_ALERT_TYPES.COST_SPIKE, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { id: true },
    }),
  ]);

  return { open, highOrCritical, hasCostAnomaly: Boolean(costAnomaly) };
}

export async function getSecurityStats(organizationId: string) {
  const [open, highOrCritical, unusualAgentIds, costAnomalies] = await Promise.all([
    prisma.securityAlert.count({ where: { organizationId, status: "OPEN" } }),
    prisma.securityAlert.count({ where: { organizationId, status: "OPEN", severity: { in: ["HIGH", "CRITICAL"] } } }),
    prisma.securityAlert.findMany({
      where: { organizationId, status: "OPEN" },
      distinct: ["agentId"],
      select: { agentId: true },
    }),
    prisma.securityAlert.count({ where: { organizationId, status: "OPEN", type: SECURITY_ALERT_TYPES.COST_SPIKE } }),
  ]);

  return { open, highOrCritical, agentsWithUnusualActivity: unusualAgentIds.length, costAnomalies };
}

type ResolveOutcome =
  | { kind: "not_found" }
  | { kind: "already_resolved"; status: SecurityAlertStatus }
  | { kind: "updated"; alert: Prisma.SecurityAlertGetPayload<{ include: typeof ALERT_INCLUDE }> };

/**
 * Shared by acknowledge/resolve: a conditional updateMany() so two
 * concurrent actions on the same alert can't both "win" — the same
 * race-safety pattern as lib/approvals/service.ts#resolveApproval, for
 * the same reason (Postgres aborts the rest of an interactive
 * transaction after a thrown error, so every branch here returns an
 * outcome descriptor instead of throwing mid-transaction).
 */
async function transitionAlert(
  organizationId: string,
  id: string,
  allowedFromStatuses: SecurityAlertStatus[],
  data: Prisma.SecurityAlertUncheckedUpdateManyInput
): Promise<ResolveOutcome> {
  return prisma.$transaction(async (tx): Promise<ResolveOutcome> => {
    const updated = await tx.securityAlert.updateMany({
      where: { id, organizationId, status: { in: allowedFromStatuses } },
      data,
    });

    if (updated.count === 0) {
      const existing = await tx.securityAlert.findFirst({ where: { id, organizationId } });
      if (!existing) return { kind: "not_found" };
      return { kind: "already_resolved", status: existing.status };
    }

    const alert = await tx.securityAlert.findUniqueOrThrow({ where: { id }, include: ALERT_INCLUDE });
    return { kind: "updated", alert };
  });
}

function throwForOutcome(outcome: ResolveOutcome): never | void {
  if (outcome.kind === "not_found") throw new SecurityAlertNotFoundError();
  if (outcome.kind === "already_resolved") throw new SecurityAlertAlreadyResolvedError(outcome.status);
}

export async function acknowledgeAlert(organizationId: string, id: string, userId: string) {
  const outcome = await transitionAlert(organizationId, id, ["OPEN"], {
    status: "ACKNOWLEDGED",
    acknowledgedAt: new Date(),
    acknowledgedByUserId: userId,
  });
  throwForOutcome(outcome);
  if (outcome.kind !== "updated") throw new SecurityAlertNotFoundError();

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "USER",
    actorUserId: userId,
    agentId: outcome.alert.agentId,
    eventType: AUDIT_EVENT_TYPES.SECURITY_ALERT_ACKNOWLEDGED,
    entityType: "SecurityAlert",
    entityId: outcome.alert.id,
    action: outcome.alert.type,
  });

  return outcome.alert;
}

export async function resolveAlert(organizationId: string, id: string, userId: string) {
  const outcome = await transitionAlert(organizationId, id, ["OPEN", "ACKNOWLEDGED"], {
    status: "RESOLVED",
    resolvedAt: new Date(),
    resolvedByUserId: userId,
  });
  throwForOutcome(outcome);
  if (outcome.kind !== "updated") throw new SecurityAlertNotFoundError();

  await recordAuditEvent(prisma, {
    organizationId,
    actorType: "USER",
    actorUserId: userId,
    agentId: outcome.alert.agentId,
    eventType: AUDIT_EVENT_TYPES.SECURITY_ALERT_RESOLVED,
    entityType: "SecurityAlert",
    entityId: outcome.alert.id,
    action: outcome.alert.type,
  });

  await dispatchWebhookEvent(organizationId, "security.alert.resolved", {
    id: outcome.alert.id,
    type: outcome.alert.type,
    agentId: outcome.alert.agentId,
  });

  return outcome.alert;
}
