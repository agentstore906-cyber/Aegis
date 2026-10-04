import "server-only";

import type { PolicyDecision, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { actionMatches } from "@/lib/policies/matcher";
import { getInventoryAgent, type InventoryAgent } from "@/lib/control/inventory";

/**
 * One agent's full control view: the inventory row plus everything behind it.
 * Tenant-scoped (the agent is resolved inside the organization first; every
 * other query filters on organizationId AND the agent's id) and bounded.
 *
 * Least-privilege REVIEW rather than a new permission language: it surfaces
 * (a) BROAD grants — an ALLOW over a whole action namespace for any resource —
 * and (b) UNUSED grants — permissions that grant access (ALLOW / ALERT) whose
 * action pattern matched nothing the agent actually did in the last 30 days.
 * Unused is judged by action only (a resource-scoped grant counts as used if
 * the action was); and "unused" means "no evidence of use in the window", which
 * a reviewer should weigh against seasonal work.
 */

export const REVIEW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const LIFECYCLE_EVENTS = ["agent.created", "agent.updated", "agent.connected", "agent.reconnected", "agent.disconnected", "agent.paused", "agent.resumed", "agent.stopped"];

type PermissionRef = { id: string; action: string; resource: string; decision: PolicyDecision };

export type AgentControlView = {
  agent: InventoryAgent;
  lifecycle: { id: string; at: Date; event: string; actor: string; from: string | null; to: string | null; reason: string | null; enforced: boolean | null }[];
  permissions: PermissionRef[];
  review: {
    windowDays: number;
    observedActions: number;
    broadGrants: PermissionRef[];
    unusedGrants: PermissionRef[];
    note: string;
  };
  policies: { id: string; name: string; decision: PolicyDecision; scope: "this agent" | "whole organization"; action: string; conditions: number }[];
  /** Keys that can act as this agent. Prefixes only — secrets are never stored or shown. */
  keys: { id: string; name: string; prefix: string; lastUsedAt: Date | null; expiresAt: Date | null }[];
  activity: { tools: { key: string; count: number }[]; destinations: { key: string; count: number }[] };
  deviations: { id: string; kind: string; confidence: string; lastSeenAt: Date; occurrences: number }[];
  risk7d: { byLevel: Record<RiskLevel, number>; recommendedStricter: number };
};

export async function getAgentControlView(organizationId: string, slug: string, now = new Date()): Promise<AgentControlView | null> {
  const agent = await getInventoryAgent(organizationId, slug, now);
  if (!agent) return null;
  const base = { organizationId, agentId: agent.id };
  const since30 = new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);

  const [permissions, eventActions, evaluationActions, policies, keys, tools, destinations, deviations, auditRows, riskLevels, stricter] = await Promise.all([
    prisma.agentPermission.findMany({ where: base, orderBy: [{ action: "asc" }, { resource: "asc" }], take: 200, select: { id: true, action: true, resource: true, decision: true } }),
    prisma.activityEvent.groupBy({ by: ["action"], where: { ...base, timestamp: { gte: since30 } }, orderBy: { action: "asc" }, take: 500 }),
    prisma.policyEvaluation.groupBy({ by: ["action"], where: { ...base, createdAt: { gte: since30 } }, orderBy: { action: "asc" }, take: 500 }),
    prisma.policy.findMany({
      where: { organizationId, status: "ACTIVE", OR: [{ agentId: agent.id }, { agentId: null }] },
      orderBy: [{ name: "asc" }],
      take: 50,
      select: { id: true, name: true, decision: true, agentId: true, action: true, _count: { select: { conditions: true } } },
    }),
    prisma.apiKey.findMany({
      where: { ...{ organizationId }, agentId: agent.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true },
    }),
    prisma.activityEvent.groupBy({ by: ["toolKey"], where: { ...base, timestamp: { gte: since7 }, toolKey: { not: null } }, _count: { _all: true }, orderBy: { _count: { toolKey: "desc" } }, take: 8 }),
    prisma.activityEvent.groupBy({ by: ["destination"], where: { ...base, timestamp: { gte: since7 }, destination: { not: null } }, _count: { _all: true }, orderBy: { _count: { destination: "desc" } }, take: 8 }),
    prisma.behavioralDeviation.findMany({ where: { ...base, lastSeenAt: { gte: since7 } }, orderBy: { lastSeenAt: "desc" }, take: 5, select: { id: true, kind: true, confidence: true, lastSeenAt: true, occurrences: true } }),
    prisma.auditEvent.findMany({
      where: { organizationId, entityType: "Agent", entityId: agent.id, eventType: { in: LIFECYCLE_EVENTS } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 50,
      select: { id: true, createdAt: true, eventType: true, actorType: true, actorUserId: true, metadata: true },
    }),
    prisma.policyEvaluation.groupBy({ by: ["riskAssessedLevel"], where: { ...base, createdAt: { gte: since7 }, riskAssessedLevel: { not: null } }, _count: { _all: true } }),
    prisma.policyEvaluation.count({ where: { ...base, createdAt: { gte: since7 }, riskShadowOutcome: "WOULD_ESCALATE" } }),
  ]);

  const observed = [...new Set([...eventActions.map((e) => e.action), ...evaluationActions.map((e) => e.action)])];
  const used = (pattern: string) => observed.some((action) => actionMatches(pattern, action));
  const ref = (p: { id: string; action: string; resource: string; decision: PolicyDecision }): PermissionRef => ({ id: p.id, action: p.action, resource: p.resource, decision: p.decision });
  const broadGrants = permissions.filter((p) => p.decision === "ALLOW" && p.resource === "" && p.action.endsWith(".*")).map(ref);
  const unusedGrants = permissions.filter((p) => (p.decision === "ALLOW" || p.decision === "ALERT") && !used(p.action)).map(ref);

  const actorIds = [...new Set(auditRows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
  const users = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
  const actorLabel = (r: { actorType: string; actorUserId: string | null }) => {
    if (r.actorUserId) {
      const u = users.find((x) => x.id === r.actorUserId);
      return u ? (u.name ?? u.email) : "a former member";
    }
    return r.actorType === "AGENT" ? "the agent" : "Aegis (automatic)";
  };

  const byLevel: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const r of riskLevels) if (r.riskAssessedLevel) byLevel[r.riskAssessedLevel] = r._count._all;

  return {
    agent,
    lifecycle: auditRows.map((r) => {
      const m = (r.metadata ?? {}) as { previousStatus?: string; newStatus?: string; reason?: string; enforced?: boolean };
      return {
        id: r.id,
        at: r.createdAt,
        event: r.eventType.replace(/^agent\./, "").replaceAll("_", " "),
        actor: actorLabel(r),
        from: m.previousStatus ?? null,
        to: m.newStatus ?? null,
        reason: m.reason ?? null,
        enforced: typeof m.enforced === "boolean" ? m.enforced : null,
      };
    }),
    permissions: permissions.map(ref),
    review: {
      windowDays: REVIEW_WINDOW_DAYS,
      observedActions: observed.length,
      broadGrants,
      unusedGrants,
      note:
        observed.length === 0
          ? `This agent did nothing in the last ${REVIEW_WINDOW_DAYS} days, so every granting permission is currently unused — there is no evidence to review against yet.`
          : `Judged against the ${observed.length} distinct action${observed.length === 1 ? "" : "s"} the agent performed or asked about in the last ${REVIEW_WINDOW_DAYS} days. "Unused" means no evidence of use in that window, not that it is safe to remove.`,
    },
    policies: policies.map((p) => ({ id: p.id, name: p.name, decision: p.decision, scope: p.agentId ? "this agent" : "whole organization", action: p.action, conditions: p._count.conditions })),
    keys,
    activity: {
      tools: tools.flatMap((t) => (t.toolKey ? [{ key: t.toolKey, count: t._count._all }] : [])),
      destinations: destinations.flatMap((d) => (d.destination ? [{ key: d.destination, count: d._count._all }] : [])),
    },
    deviations,
    risk7d: { byLevel, recommendedStricter: stricter },
  };
}
