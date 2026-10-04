import "server-only";

import type { Prisma } from "@prisma/client";

import { TRUST_ALERT_TYPES, TRUST_CATEGORIES, TRUST_EVIDENCE_LIMITS } from "@/lib/trust/config";
import type { TrustEvidence } from "@/lib/trust/types";

/**
 * Reads the evidence trust is computed from. Every query is scoped to the
 * organization AND the agent, inside the caller's transaction. Only windows
 * the scorer can still use are read, each bounded (TRUST_EVIDENCE_LIMITS),
 * newest first. Returns null when the agent isn't in the organization.
 *
 * Deliberately NOT read: agent riskLevel / environment / permissions (static
 * configuration, not observed behavior — the unified risk engine's input, not
 * trust's), and kill-switch refusals (operator actions, not agent behavior).
 */
export async function gatherTrustEvidence(
  tx: Prisma.TransactionClient,
  organizationId: string,
  agentId: string,
  now: Date
): Promise<TrustEvidence | null> {
  const agent = await tx.agent.findFirst({
    where: { id: agentId, organizationId },
    select: { status: true, createdAt: true },
  });
  if (!agent) return null;

  const since = (windowMs: number) => new Date(now.getTime() - windowMs);
  const { behavior, blocked, violations, alerts, approvals } = TRUST_CATEGORIES;

  const [baseline, deviations, blocks, violationRows, alertRows, approvalRows] = await Promise.all([
    tx.agentBaseline.findFirst({
      where: { agentId, organizationId },
      orderBy: { version: "desc" },
      select: { maturity: true },
    }),
    tx.behavioralDeviation.findMany({
      where: { organizationId, agentId, lastSeenAt: { gte: since(behavior.windowMs) } },
      orderBy: { lastSeenAt: "desc" },
      take: TRUST_EVIDENCE_LIMITS.deviations,
      select: { id: true, kind: true, dedupeKey: true, confidence: true, occurrences: true, lastSeenAt: true },
    }),
    tx.policyEvaluation.findMany({
      where: {
        organizationId,
        agentId,
        decision: "BLOCK",
        createdAt: { gte: since(blocked.windowMs) },
        // Kill-switch refusals say nothing about the agent's behavior. Legacy rows have no source (null).
        // P5: risk-control gates are the system's own action (and would feed back into risk) — excluded too.
        OR: [{ decisionSource: null }, { decisionSource: { notIn: ["CONTROL", "RISK"] } }],
      },
      orderBy: { createdAt: "desc" },
      take: TRUST_EVIDENCE_LIMITS.evaluations,
      select: { id: true, action: true, decisionSource: true, createdAt: true },
    }),
    tx.policyEvaluation.findMany({
      where: {
        organizationId,
        agentId,
        decision: "ALERT",
        createdAt: { gte: since(violations.windowMs) },
        OR: [{ decisionSource: null }, { decisionSource: { not: "RISK" } }],
      },
      orderBy: { createdAt: "desc" },
      take: TRUST_EVIDENCE_LIMITS.evaluations,
      select: { id: true, action: true, createdAt: true },
    }),
    tx.securityAlert.findMany({
      where: {
        organizationId,
        agentId,
        type: { in: [...TRUST_ALERT_TYPES] },
        lastSeenAt: { gte: since(alerts.windowMs) },
      },
      orderBy: { lastSeenAt: "desc" },
      take: TRUST_EVIDENCE_LIMITS.alerts,
      select: { id: true, type: true, title: true, severity: true, status: true, lastSeenAt: true },
    }),
    tx.approvalRequest.findMany({
      where: { organizationId, agentId, status: "REJECTED", resolvedAt: { gte: since(approvals.windowMs) } },
      orderBy: { resolvedAt: "desc" },
      take: TRUST_EVIDENCE_LIMITS.approvals,
      select: { id: true, action: true, resolvedAt: true },
    }),
  ]);

  return {
    agent,
    baselineMaturity: baseline?.maturity ?? null,
    deviations,
    blocks,
    violations: violationRows,
    alerts: alertRows,
    rejectedApprovals: approvalRows.flatMap((r) => (r.resolvedAt ? [{ id: r.id, action: r.action, resolvedAt: r.resolvedAt }] : [])),
  };
}
