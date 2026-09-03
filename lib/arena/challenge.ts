import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";

/**
 * Challenge attribution. When a visitor clicks "Challenge This Agent" on a
 * public scorecard, an ArenaChallengeAttribution row is created and its
 * token dropped in a short-lived cookie. That token survives the
 * signup/login round trip, so the challenger's first benchmark can be
 * linked back to the scorecard that provoked it — which is what makes the
 * viral K-factor measurable.
 */
export const ARENA_CHALLENGE_COOKIE = "aegis_arena_challenge";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function newAttributionToken(): string {
  return `${randomUUID()}${randomBytes(8).toString("hex")}`;
}

export async function createChallengeAttribution(scorecardId: string): Promise<string> {
  const token = newAttributionToken();
  await prisma.arenaChallengeAttribution.create({ data: { token, scorecardId } });

  const jar = await cookies();
  jar.set(ARENA_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return token;
}

/**
 * Reads the pending challenge (if any) from the cookie. Returns the source
 * scorecard's public projection data needed to render the "you're
 * challenging X" banner.
 */
export async function getPendingChallenge(): Promise<
  | {
      attributionId: string;
      sourceScorecardId: string;
      targetScore: number;
      targetDisplayName: string;
      publicSlug: string;
    }
  | null
> {
  const jar = await cookies();
  const token = jar.get(ARENA_CHALLENGE_COOKIE)?.value;
  if (!token) return null;

  const attribution = await prisma.arenaChallengeAttribution.findUnique({ where: { token } });
  if (!attribution || attribution.convertedAt) return null;

  const source = await prisma.arenaScorecard.findUnique({
    where: { id: attribution.scorecardId },
    select: { id: true, overallScore: true, displayName: true, publicSlug: true, isPublic: true },
  });
  if (!source || !source.isPublic || source.overallScore === null || !source.publicSlug) return null;

  return {
    attributionId: attribution.id,
    sourceScorecardId: source.id,
    targetScore: source.overallScore,
    targetDisplayName: source.displayName ?? "Anonymous Agent",
    publicSlug: source.publicSlug,
  };
}

export async function clearPendingChallenge(): Promise<void> {
  const jar = await cookies();
  jar.delete(ARENA_CHALLENGE_COOKIE);
}

/** Marks an attribution converted and records which scorecard resulted from it. */
export async function markChallengeConverted(
  attributionId: string,
  resultScorecardId: string
): Promise<void> {
  await prisma.arenaChallengeAttribution.updateMany({
    where: { id: attributionId, convertedAt: null },
    data: { convertedAt: new Date(), resultId: resultScorecardId },
  });
}
