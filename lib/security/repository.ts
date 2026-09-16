import "server-only";

import type { AgentStatus, Prisma, RiskLevel, SecurityAlertSeverity, SecurityAlertStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import type { Finding } from "@/lib/security/types";
import { SecurityAlertAlreadyResolvedError, SecurityAlertNotFoundError } from "@/lib/security/types";
import { DELETE_KEYWORDS } from "@/lib/security/risk-scoring";
import { computeAgentRiskScore, type RiskScore } from "@/lib/security/risk-score";

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
      data: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        evidence: redactedEvidence,
        severity: finding.severity,
        confidence: finding.confidence ?? undefined,
        recommendedAction: finding.recommendedAction ?? undefined,
      },
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
      confidence: finding.confidence ?? undefined,
      recommendedAction: finding.recommendedAction ?? undefined,
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

/** Alert types that mean "this agent's behavior pattern itself looks off," feeding the Agent Health card's Activity: Normal/Unusual line — distinct from a single risky action or a cost anomaly. */
const ACTIVITY_ANOMALY_TYPES = [
  SECURITY_ALERT_TYPES.ACTIVITY_VOLUME_SPIKE,
  SECURITY_ALERT_TYPES.HIGH_RISK_BURST,
  SECURITY_ALERT_TYPES.BLOCK_SPIKE,
  SECURITY_ALERT_TYPES.DATA_ACCESS_SPIKE,
  SECURITY_ALERT_TYPES.DELETE_ACTIVITY_SPIKE,
  SECURITY_ALERT_TYPES.COMMUNICATION_SPIKE,
] as const;

/** Alert types treated as "this agent recently gained a new capability" — a data point for the risk score, not itself a red flag. */
const NEW_CAPABILITY_ALERT_TYPES = [
  SECURITY_ALERT_TYPES.NEW_SENSITIVE_ACTION,
  SECURITY_ALERT_TYPES.NEW_TOOL_USAGE,
] as const;

export async function getSecurityStatsForAgent(organizationId: string, agentId: string) {
  const [open, highOrCritical, costAnomaly, activityAnomaly] = await Promise.all([
    prisma.securityAlert.count({ where: { organizationId, agentId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.securityAlert.count({
      where: { organizationId, agentId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: { in: ["HIGH", "CRITICAL"] } },
    }),
    prisma.securityAlert.findFirst({
      where: { organizationId, agentId, type: SECURITY_ALERT_TYPES.COST_SPIKE, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { id: true },
    }),
    prisma.securityAlert.findFirst({
      where: { organizationId, agentId, type: { in: [...ACTIVITY_ANOMALY_TYPES] }, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      select: { id: true },
    }),
  ]);

  return { open, highOrCritical, hasCostAnomaly: Boolean(costAnomaly), hasActivityAnomaly: Boolean(activityAnomaly) };
}

const RISK_SCORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Assembles the real, already-scoped signals for one agent and hands them
 * to the pure scorer (lib/security/risk-score.ts). This is the only place
 * that queries the database for a risk score — the scoring logic itself
 * stays testable without one.
 */
export async function getAgentRiskScore(
  organizationId: string,
  agent: { id: string; riskLevel: RiskLevel }
): Promise<RiskScore> {
  const since = new Date(Date.now() - RISK_SCORE_WINDOW_MS);
  const deleteKeywordFilter = {
    OR: DELETE_KEYWORDS.flatMap((keyword) => [
      { action: { contains: keyword, mode: "insensitive" as const } },
      { resource: { contains: keyword, mode: "insensitive" as const } },
    ]),
  };

  const [
    openAlertsBySeverity,
    hasNewCapabilityAlert,
    blockedActions7d,
    policyViolations7d,
    failedActions7d,
    destructiveActions7d,
  ] = await Promise.all([
    prisma.securityAlert.groupBy({
      by: ["severity"],
      where: { organizationId, agentId: agent.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      _count: true,
    }),
    prisma.securityAlert.findFirst({
      where: {
        organizationId,
        agentId: agent.id,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        type: { in: [...NEW_CAPABILITY_ALERT_TYPES] },
      },
      select: { id: true },
    }),
    prisma.activityEvent.count({
      where: { organizationId, agentId: agent.id, status: "BLOCKED", timestamp: { gte: since } },
    }),
    prisma.policyEvaluation.count({
      where: { organizationId, agentId: agent.id, decision: "BLOCK", createdAt: { gte: since } },
    }),
    prisma.activityEvent.count({
      where: { organizationId, agentId: agent.id, status: "FAILED", timestamp: { gte: since } },
    }),
    prisma.activityEvent.count({
      where: { organizationId, agentId: agent.id, timestamp: { gte: since }, ...deleteKeywordFilter },
    }),
  ]);

  const bySeverity = new Map(openAlertsBySeverity.map((row) => [row.severity, row._count]));

  return computeAgentRiskScore({
    agentRiskLevel: agent.riskLevel,
    openCriticalAlerts: bySeverity.get("CRITICAL") ?? 0,
    openHighAlerts: bySeverity.get("HIGH") ?? 0,
    openMediumAlerts: bySeverity.get("MEDIUM") ?? 0,
    hasNewCapabilityAlert: hasNewCapabilityAlert !== null,
    blockedActions7d,
    policyViolations7d,
    failedActions7d,
    destructiveActions7d,
  });
}

/** Every alert type that represents a detected deviation from an agent's own baseline — the org-wide "Recent anomalies" feed on /overview, as opposed to a single risky action or a manually-configured policy block. */
const ANOMALY_ALERT_TYPES = [...ACTIVITY_ANOMALY_TYPES, SECURITY_ALERT_TYPES.COST_SPIKE, SECURITY_ALERT_TYPES.FAILURE_LOOP] as const;

/** Recent anomaly alerts across the whole organization, most severe and most recent first — feeds the dashboard's "Recent anomalies" card. */
export async function listRecentAnomalies(organizationId: string, limit = 5) {
  return prisma.securityAlert.findMany({
    where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: { in: [...ANOMALY_ALERT_TYPES] } },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
  });
}

export type HighRiskAgentSummary = {
  agent: { id: string; name: string; slug: string; riskLevel: RiskLevel; status: AgentStatus };
  criticalAlertCount: number;
  highOrCriticalAlertCount: number;
};

/**
 * Ranks agents by open high/critical security alert volume — a cheap,
 * bulk proxy for "who needs attention right now" on the org dashboard.
 * Deliberately not the full per-agent RiskScore (getAgentRiskScore):
 * computing that for every agent on every dashboard load would mean N
 * extra queries per agent. Two bounded groupBy queries plus one `id IN
 * (...)` lookup, regardless of how many agents the org has.
 */
export async function getHighRiskAgentsSummary(organizationId: string, limit = 5): Promise<HighRiskAgentSummary[]> {
  const [highOrCriticalGrouped, criticalGrouped] = await Promise.all([
    prisma.securityAlert.groupBy({
      by: ["agentId"],
      where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: { in: ["HIGH", "CRITICAL"] } },
      _count: true,
    }),
    prisma.securityAlert.groupBy({
      by: ["agentId"],
      where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: "CRITICAL" },
      _count: true,
    }),
  ]);

  if (highOrCriticalGrouped.length === 0) return [];

  const criticalByAgent = new Map(criticalGrouped.map((row) => [row.agentId, row._count]));
  const agents = await prisma.agent.findMany({
    where: { organizationId, id: { in: highOrCriticalGrouped.map((row) => row.agentId) } },
    select: { id: true, name: true, slug: true, riskLevel: true, status: true },
  });
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  return highOrCriticalGrouped
    .map((row) => ({
      agent: agentById.get(row.agentId),
      criticalAlertCount: criticalByAgent.get(row.agentId) ?? 0,
      highOrCriticalAlertCount: row._count,
    }))
    .filter((row): row is HighRiskAgentSummary => row.agent !== undefined)
    .sort((a, b) => b.criticalAlertCount - a.criticalAlertCount || b.highOrCriticalAlertCount - a.highOrCriticalAlertCount)
    .slice(0, limit);
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
