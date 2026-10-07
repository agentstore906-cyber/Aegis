import "server-only";

import { prisma } from "@/lib/db";
import { connectionSummary, deriveConnectionView, type ConnectionState, type MonitoringState } from "@/lib/agents/connection-state";
import type { TrustState } from "@prisma/client";

/**
 * Open (not yet acknowledged or resolved) security alerts per agent, for the agents given — one grouped query,
 * tenant-scoped. Callers must only use this when the viewer may see security information.
 */
export async function getOpenAlertCounts(organizationId: string, agentIds: string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const grouped = await prisma.securityAlert.groupBy({
    by: ["agentId"],
    where: { organizationId, agentId: { in: agentIds }, status: "OPEN" },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.agentId, g._count._all]));
}

export type AgentListSignals = {
  connection: { state: ConnectionState; label: string; summary: string; lastSeenAt: Date | null; monitoring: MonitoringState };
  /** Only present when the trust engine has actually evaluated this agent. */
  trust: { score: number; state: TrustState } | null;
};

/**
 * Connection and trust for one page of agents, read in three batched queries (not per agent).
 * Connection state is the same evidence-based derivation the agent page uses; trust is read from the trust
 * engine's stored result and is null — never a default — when no evaluation exists.
 */
export async function getAgentListSignals(organizationId: string, agentIds: string[], now: Date = new Date()): Promise<Map<string, AgentListSignals>> {
  const out = new Map<string, AgentListSignals>();
  if (agentIds.length === 0) return out;

  const [connections, reported, trust] = await Promise.all([
    prisma.agentConnection.findMany({
      where: { organizationId, agentId: { in: agentIds } },
      include: { apiKey: { select: { revokedAt: true, expiresAt: true } } },
    }),
    prisma.activityEvent.groupBy({
      by: ["agentId"],
      where: { organizationId, agentId: { in: agentIds }, source: "api" },
      _count: { _all: true },
      _max: { timestamp: true },
    }),
    prisma.agentTrustState.findMany({ where: { organizationId, agentId: { in: agentIds } }, select: { agentId: true, score: true, state: true } }),
  ]);

  const connByAgent = new Map(connections.map((c) => [c.agentId, c]));
  const reportedByAgent = new Map(reported.map((r) => [r.agentId, r]));
  const trustByAgent = new Map(trust.map((t) => [t.agentId, t]));

  for (const id of agentIds) {
    const c = connByAgent.get(id);
    const r = reportedByAgent.get(id);
    const count = r?._count._all ?? 0;
    const view = deriveConnectionView(
      {
        connectorType: c?.connectorType ?? "CUSTOM_SDK",
        status: c?.status ?? (count > 0 ? "CONNECTED" : "CONNECTING"),
        disconnectedAt: c?.disconnectedAt ?? null,
        firstHandshakeAt: c?.firstHandshakeAt ?? null,
        lastSeenAt: c?.lastSeenAt ?? null,
        lastVerifiedAt: c?.lastVerifiedAt ?? null,
        lastHealthError: c?.lastHealthError ?? null,
        apiKey: c?.apiKey ?? null,
        reportedEventCount: count,
        lastReportedEventAt: r?._max.timestamp ?? null,
        decisionRequests7d: 0,
      },
      now
    );
    const t = trustByAgent.get(id);
    out.set(id, {
      connection: { state: view.state, label: view.stateLabel, summary: connectionSummary(view), lastSeenAt: view.lastSeenAt, monitoring: view.monitoring },
      trust: t ? { score: t.score, state: t.state } : null,
    });
  }
  return out;
}
