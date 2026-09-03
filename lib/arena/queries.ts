import "server-only";

import { prisma } from "@/lib/db";
import { toPublicScorecard, type PublicScorecard } from "@/lib/arena/share";

/**
 * All reads are explicitly organization-scoped. The public lookup
 * (getPublicScorecardBySlug) is the one exception — it is reached by an
 * unguessable slug and returns only the privacy-safe projection.
 */

export async function listAgentsForArena(organizationId: string) {
  const agents = await prisma.agent.findMany({
    where: { organizationId, status: { not: "ARCHIVED" } },
    orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      modelProvider: true,
      modelName: true,
      lastActiveAt: true,
      _count: { select: { activityEvents: true } },
    },
    take: 100,
  });

  const latest = await prisma.arenaScorecard.findMany({
    where: { organizationId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { id: true, agentId: true, overallScore: true, completedAt: true, isPublic: true },
  });

  const latestByAgent = new Map<string, (typeof latest)[number]>();
  for (const s of latest) {
    if (!latestByAgent.has(s.agentId)) latestByAgent.set(s.agentId, s);
  }

  return agents.map((agent) => ({
    ...agent,
    eventCount: agent._count.activityEvents,
    latestScorecard: latestByAgent.get(agent.id) ?? null,
  }));
}

export async function listScorecards(organizationId: string, limit = 25) {
  const rows = await prisma.arenaScorecard.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      agentId: true,
      status: true,
      overallScore: true,
      categoryScores: true,
      isPublic: true,
      publicSlug: true,
      displayName: true,
      challengedFromId: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const agentIds = [...new Set(rows.map((r) => r.agentId))];
  const agents = await prisma.agent.findMany({
    where: { organizationId, id: { in: agentIds } },
    select: { id: true, name: true, slug: true },
  });
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return rows.map((row) => ({ ...row, agent: agentById.get(row.agentId) ?? null }));
}

export async function getScorecard(organizationId: string, id: string) {
  const scorecard = await prisma.arenaScorecard.findFirst({
    where: { id, organizationId },
    include: {
      scenarioResults: { orderBy: [{ category: "asc" }, { scenarioKey: "asc" }] },
    },
  });
  if (!scorecard) return null;

  const agent = await prisma.agent.findFirst({
    where: { id: scorecard.agentId, organizationId },
    select: { id: true, name: true, slug: true, modelProvider: true, modelName: true },
  });

  let challengedFrom: { publicSlug: string | null; overallScore: number | null; displayName: string | null } | null =
    null;
  if (scorecard.challengedFromId) {
    challengedFrom = await prisma.arenaScorecard.findUnique({
      where: { id: scorecard.challengedFromId },
      select: { publicSlug: true, overallScore: true, displayName: true },
    });
  }

  return { ...scorecard, agent, challengedFrom };
}

export async function getPublicScorecardBySlug(slug: string): Promise<PublicScorecard | null> {
  const row = await prisma.arenaScorecard.findUnique({
    where: { publicSlug: slug },
    select: {
      publicSlug: true,
      displayName: true,
      overallScore: true,
      categoryScores: true,
      benchmarkVersion: true,
      publishedAt: true,
      isPublic: true,
    },
  });
  if (!row) return null;
  return toPublicScorecard(row);
}

/** Raw id lookup for the challenge route — returns only what it needs. */
export async function getPublicScorecardId(slug: string): Promise<string | null> {
  const row = await prisma.arenaScorecard.findUnique({
    where: { publicSlug: slug },
    select: { id: true, isPublic: true },
  });
  return row?.isPublic ? row.id : null;
}
