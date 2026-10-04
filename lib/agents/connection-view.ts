import "server-only";

import { prisma } from "@/lib/db";
import { deriveConnectionView, type ConnectionView } from "@/lib/agents/connection-state";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AgentConnectionSnapshot = {
  agent: { id: string; slug: string; name: string; environment: string };
  hasConnectionRecord: boolean;
  connectorType: string | null;
  view: ConnectionView;
  /** The behavioral baseline, only if one has actually been computed. Never an invented confidence. */
  baseline: { maturity: string; eventsObserved: number; version: number } | null;
  /** Reported events observed so far (the number the baseline will learn from). */
  eventsObserved: number;
};

/**
 * Everything the connection UI shows, read from the database for ONE organization (the caller passes the
 * organization from its authenticated membership; the slug alone never reaches another tenant's agent).
 * Returns null when the agent does not exist in that organization.
 */
export async function getAgentConnectionSnapshot(organizationId: string, slug: string, now: Date = new Date()): Promise<AgentConnectionSnapshot | null> {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug } },
    select: {
      id: true,
      slug: true,
      name: true,
      environment: true,
      connection: { include: { apiKey: { select: { revokedAt: true, expiresAt: true } } } },
    },
  });
  if (!agent) return null;

  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [reported, decisions, baseline] = await Promise.all([
    prisma.activityEvent.aggregate({
      where: { organizationId, agentId: agent.id, source: "api" },
      _count: { _all: true },
      _max: { timestamp: true },
    }),
    prisma.activityEvent.count({ where: { organizationId, agentId: agent.id, source: "policy_evaluation", timestamp: { gte: since } } }),
    prisma.agentBaseline.findFirst({
      where: { organizationId, agentId: agent.id },
      orderBy: { version: "desc" },
      select: { maturity: true, eventsObserved: true, version: true },
    }),
  ]);

  const c = agent.connection;
  const view = deriveConnectionView(
    {
      // An agent with no connection record is a legacy/API-registered agent: judged by the evidence it has produced.
      connectorType: c?.connectorType ?? "CUSTOM_SDK",
      status: c?.status ?? (reported._count._all > 0 ? "CONNECTED" : "CONNECTING"),
      disconnectedAt: c?.disconnectedAt ?? null,
      firstHandshakeAt: c?.firstHandshakeAt ?? null,
      lastSeenAt: c?.lastSeenAt ?? null,
      lastVerifiedAt: c?.lastVerifiedAt ?? null,
      lastHealthError: c?.lastHealthError ?? null,
      apiKey: c?.apiKey ?? null,
      reportedEventCount: reported._count._all,
      lastReportedEventAt: reported._max.timestamp ?? null,
      decisionRequests7d: decisions,
    },
    now
  );

  return {
    agent: { id: agent.id, slug: agent.slug, name: agent.name, environment: agent.environment },
    hasConnectionRecord: c !== null,
    connectorType: c?.connectorType ?? null,
    view,
    baseline,
    eventsObserved: reported._count._all,
  };
}
