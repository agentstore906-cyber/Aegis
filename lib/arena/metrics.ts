import "server-only";

import { prisma } from "@/lib/db";

/**
 * The three viral-loop numbers the spec asks Arena to measure, computed
 * from real persisted data (ArenaScorecard, ArenaChallengeAttribution,
 * ArenaAnalyticsEvent) — never estimated.
 *
 * Scoped to one organization's own scorecards as the challenge *source*:
 * "the agents you benchmarked and published provoked N challenges, M of
 * which turned into a real competing score."
 */
export type ArenaViralMetrics = {
  completedScorecards: number;
  publicScorecards: number;
  scorecardViews: number;
  challengesCreated: number;
  challengesConverted: number;
  /** challengesCreated / scorecardViews */
  challengeRate: number;
  /** challengesConverted / challengesCreated */
  challengeConversion: number;
  /** (challengesCreated / publicScorecards) * challengeConversion */
  viralKFactor: number;
};

export async function getArenaViralMetrics(organizationId: string): Promise<ArenaViralMetrics> {
  const [completedScorecards, publicScorecardRows] = await Promise.all([
    prisma.arenaScorecard.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.arenaScorecard.findMany({
      where: { organizationId, isPublic: true },
      select: { id: true },
    }),
  ]);

  const publicIds = publicScorecardRows.map((r) => r.id);

  const [scorecardViews, challengesCreated, challengesConverted] = await Promise.all([
    publicIds.length
      ? prisma.arenaAnalyticsEvent.count({
          where: { event: "scorecard_viewed", scorecardId: { in: publicIds } },
        })
      : 0,
    publicIds.length
      ? prisma.arenaChallengeAttribution.count({ where: { scorecardId: { in: publicIds } } })
      : 0,
    publicIds.length
      ? prisma.arenaChallengeAttribution.count({
          where: { scorecardId: { in: publicIds }, convertedAt: { not: null } },
        })
      : 0,
  ]);

  const challengeRate = ratio(challengesCreated, scorecardViews);
  const challengeConversion = ratio(challengesConverted, challengesCreated);
  const invitesPerScorecard = ratio(challengesCreated, publicIds.length);
  const viralKFactor = invitesPerScorecard * challengeConversion;

  return {
    completedScorecards,
    publicScorecards: publicIds.length,
    scorecardViews,
    challengesCreated,
    challengesConverted,
    challengeRate,
    challengeConversion,
    viralKFactor,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}
