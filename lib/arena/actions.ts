"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canPublishArenaScorecard, canRunArenaBenchmark } from "@/lib/arena/authorization";
import { runArenaBenchmark } from "@/lib/arena/benchmark";
import { trackArenaEvent } from "@/lib/arena/analytics";
import {
  clearPendingChallenge,
  getPendingChallenge,
  markChallengeConverted,
} from "@/lib/arena/challenge";
import { sanitizeDisplayName } from "@/lib/arena/share";
import { ARENA_BENCHMARK_VERSION } from "@/lib/arena/types";

export type StartBenchmarkState = { error?: string };

/**
 * Connect → Test. Runs the benchmark for an already-connected agent through
 * the existing Aegis connection and redirects to the resulting scorecard.
 * Runs inline: this codebase has no background-job infrastructure (see the
 * webhooks note in prisma/schema.prisma) and the benchmark is bounded and
 * side-effect-free.
 */
export async function startBenchmarkAction(
  _prev: StartBenchmarkState,
  formData: FormData
): Promise<StartBenchmarkState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canRunArenaBenchmark(role)) {
    return { error: "You don't have permission to run benchmarks." };
  }

  const agentSlug = String(formData.get("agentSlug") ?? "");
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId: organization.id, slug: agentSlug } },
    select: { id: true },
  });
  if (!agent) return { error: "Agent not found in this organization." };

  const pendingChallenge = await getPendingChallenge();

  const scorecard = await prisma.arenaScorecard.create({
    data: {
      organizationId: organization.id,
      agentId: agent.id,
      status: "RUNNING",
      benchmarkVersion: ARENA_BENCHMARK_VERSION,
      challengedFromId: pendingChallenge?.sourceScorecardId ?? null,
    },
  });

  await trackArenaEvent("benchmark_started", {
    organizationId: organization.id,
    scorecardId: scorecard.id,
    properties: { challenged: Boolean(pendingChallenge) },
  });

  try {
    const result = await runArenaBenchmark(organization.id, agent.id);

    await prisma.$transaction([
      prisma.arenaScorecard.update({
        where: { id: scorecard.id },
        data: {
          status: "COMPLETED",
          overallScore: result.overallScore,
          categoryScores: result.categoryScores,
          metrics: result.metrics,
          completedAt: new Date(),
        },
      }),
      prisma.arenaScenarioResult.createMany({
        data: result.scenarioOutcomes.map((o) => ({
          scorecardId: scorecard.id,
          category: o.category,
          scenarioKey: o.key,
          title: o.title,
          passed: o.passed,
          score: o.score,
          weight: o.weight,
          detail: o.detail,
        })),
      }),
    ]);

    await trackArenaEvent("benchmark_completed", {
      organizationId: organization.id,
      scorecardId: scorecard.id,
      properties: { overallScore: result.overallScore },
    });
    await trackArenaEvent("score_generated", {
      organizationId: organization.id,
      scorecardId: scorecard.id,
      properties: { overallScore: result.overallScore },
    });

    if (pendingChallenge) {
      await markChallengeConverted(pendingChallenge.attributionId, scorecard.id);
      await clearPendingChallenge();
      await trackArenaEvent("challenge_completed", {
        organizationId: organization.id,
        scorecardId: scorecard.id,
        properties: {
          beat: result.overallScore > pendingChallenge.targetScore,
          targetScore: pendingChallenge.targetScore,
        },
      });
    }
  } catch (error) {
    await prisma.arenaScorecard.update({
      where: { id: scorecard.id },
      data: { status: "FAILED", errorMessage: "The benchmark could not complete. Please try again." },
    });
    console.error(JSON.stringify({ msg: "arena_benchmark_failed", scorecardId: scorecard.id, error: String(error) }));
    return { error: "The benchmark could not complete. Please try again." };
  }

  revalidatePath("/arena");
  redirect(`/arena/${scorecard.id}`);
}

export type PublishState = { error?: string; ok?: boolean };

export async function makeScorecardPublicAction(
  scorecardId: string,
  _prev: PublishState,
  formData: FormData
): Promise<PublishState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canPublishArenaScorecard(role)) {
    return { error: "You don't have permission to publish scorecards." };
  }

  const scorecard = await prisma.arenaScorecard.findFirst({
    where: { id: scorecardId, organizationId: organization.id },
    select: { id: true, status: true, publicSlug: true },
  });
  if (!scorecard) return { error: "Scorecard not found." };
  if (scorecard.status !== "COMPLETED") return { error: "This benchmark hasn't finished yet." };

  const displayName = sanitizeDisplayName(String(formData.get("displayName") ?? ""));
  const publicSlug = scorecard.publicSlug ?? (await mintUniqueSlug());

  await prisma.arenaScorecard.update({
    where: { id: scorecard.id },
    data: { isPublic: true, publicSlug, displayName, publishedAt: new Date() },
  });

  await trackArenaEvent("scorecard_made_public", {
    organizationId: organization.id,
    scorecardId: scorecard.id,
  });

  revalidatePath("/arena");
  revalidatePath(`/arena/${scorecard.id}`);
  return { ok: true };
}

export async function makeScorecardPrivateAction(scorecardId: string): Promise<void> {
  const { organization, role } = await requireActiveOrganization();
  if (!canPublishArenaScorecard(role)) {
    throw new Error("You don't have permission to change scorecard visibility.");
  }

  await prisma.arenaScorecard.updateMany({
    where: { id: scorecardId, organizationId: organization.id },
    data: { isPublic: false },
  });

  revalidatePath("/arena");
  revalidatePath(`/arena/${scorecardId}`);
}

export async function recordArenaShareAction(scorecardId: string): Promise<void> {
  const { organization } = await requireActiveOrganization();
  const scorecard = await prisma.arenaScorecard.findFirst({
    where: { id: scorecardId, organizationId: organization.id },
    select: { id: true },
  });
  if (!scorecard) return;
  await trackArenaEvent("scorecard_shared", {
    organizationId: organization.id,
    scorecardId: scorecard.id,
  });
}

async function mintUniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = randomBytes(9).toString("base64url");
    const existing = await prisma.arenaScorecard.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique scorecard slug.");
}
