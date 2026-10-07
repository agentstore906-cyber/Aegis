import "server-only";

import { prisma } from "@/lib/db";

/**
 * The "Security Activity" feed on Aegis Control: the most recent REAL events of one organization, merged and sorted.
 * Nothing is synthesized — every item is a stored row, and an organization with none gets an empty list.
 *
 *   alerts        security alerts                          (only for viewers who may see security alerts)
 *   connections   an agent's first verified contact, and disconnections (from the connection record's own timestamps;
 *                 a connection that was never verified produces no event)
 *   decisions     Aegis returned BLOCK / REQUIRE_APPROVAL  (only for viewers who may see security data)
 *   approvals     approval requests
 *
 * Every query filters on organizationId. Bounded: a handful of rows per source, then the newest `limit` overall.
 */

export type ActivityKind = "alert" | "connection" | "decision" | "approval";
export type ActivityTone = "neutral" | "success" | "warning" | "danger" | "approval";
export type ActivityItem = { id: string; at: Date; kind: ActivityKind; title: string; detail: string; href: string; tone: ActivityTone };

const PER_SOURCE = 6;

export async function getSecurityActivity(params: { organizationId: string; canViewSecurity: boolean; limit?: number }): Promise<ActivityItem[]> {
  const { organizationId, canViewSecurity } = params;
  const limit = params.limit ?? 8;

  const [alerts, firstContact, disconnected, decisions, approvals] = await Promise.all([
    canViewSecurity
      ? prisma.securityAlert.findMany({
          where: { organizationId },
          orderBy: { lastSeenAt: "desc" },
          take: PER_SOURCE,
          select: { id: true, title: true, severity: true, status: true, lastSeenAt: true, agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.agentConnection.findMany({
      where: { organizationId, firstHandshakeAt: { not: null } },
      orderBy: { firstHandshakeAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, firstHandshakeAt: true, agent: { select: { name: true, slug: true } } },
    }),
    prisma.agentConnection.findMany({
      where: { organizationId, disconnectedAt: { not: null } },
      orderBy: { disconnectedAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, disconnectedAt: true, agent: { select: { name: true, slug: true } } },
    }),
    canViewSecurity
      ? prisma.policyEvaluation.findMany({
          where: { organizationId, decision: { in: ["BLOCK", "REQUIRE_APPROVAL"] } },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE,
          select: { id: true, action: true, decision: true, createdAt: true, agent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    prisma.approvalRequest.findMany({
      where: { organizationId },
      orderBy: { requestedAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, action: true, status: true, requestedAt: true, agent: { select: { name: true } } },
    }),
  ]);

  const items: ActivityItem[] = [
    ...alerts.map((a): ActivityItem => ({
      id: `alert:${a.id}`,
      at: a.lastSeenAt,
      kind: "alert",
      title: a.title,
      detail: `${a.agent.name} · ${a.severity.toLowerCase()} severity · ${a.status.toLowerCase()}`,
      href: `/security/${a.id}`,
      tone: a.severity === "CRITICAL" || a.severity === "HIGH" ? "danger" : "warning",
    })),
    ...firstContact.flatMap((c): ActivityItem[] =>
      c.firstHandshakeAt ? [{ id: `connected:${c.id}`, at: c.firstHandshakeAt, kind: "connection", title: `${c.agent.name} connected`, detail: "Aegis verified the connection", href: `/agents/${c.agent.slug}`, tone: "success" }] : []
    ),
    ...disconnected.flatMap((c): ActivityItem[] =>
      c.disconnectedAt ? [{ id: `disconnected:${c.id}`, at: c.disconnectedAt, kind: "connection", title: `${c.agent.name} disconnected`, detail: "The connection was disconnected", href: `/agents/${c.agent.slug}`, tone: "neutral" }] : []
    ),
    ...decisions.map((d): ActivityItem => ({
      id: `decision:${d.id}`,
      at: d.createdAt,
      kind: "decision",
      title: `Aegis returned ${d.decision === "BLOCK" ? "BLOCK" : "REQUIRE_APPROVAL"} for ${d.action}`,
      detail: d.agent.name,
      href: `/policies/evaluations/${d.id}`,
      tone: d.decision === "BLOCK" ? "danger" : "approval",
    })),
    ...approvals.map((r): ActivityItem => ({
      id: `approval:${r.id}`,
      at: r.requestedAt,
      kind: "approval",
      title: `Approval requested: ${r.action}`,
      detail: `${r.agent.name} · ${r.status.toLowerCase().replaceAll("_", " ")}`,
      href: `/approvals/${r.id}`,
      tone: "approval",
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Open (not yet resolved) security alerts of one organization. A count of stored rows. */
export function countOpenAlerts(organizationId: string): Promise<number> {
  return prisma.securityAlert.count({ where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
}
