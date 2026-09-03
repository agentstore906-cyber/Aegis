import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Swords } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canPublishArenaScorecard } from "@/lib/arena/authorization";
import { getScorecard } from "@/lib/arena/queries";
import { getCurrentOrigin } from "@/lib/request-origin";
import {
  ARENA_CATEGORIES,
  type ArenaCategory,
} from "@/lib/arena/types";
import { parseCategoryScores, shareCardText, challengePrompt } from "@/lib/arena/share";
import { formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ScoreDial } from "@/components/arena/score-dial";
import { CategoryBars } from "@/components/arena/category-bars";
import { ScenarioBreakdown } from "@/components/arena/scenario-breakdown";
import { SharePanel } from "@/components/arena/share-panel";
import { BeatBanner } from "@/components/arena/challenge-banner";

export const metadata: Metadata = { title: "Scorecard" };

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization, role } = await requireActiveOrganization();
  const { id } = await params;

  const scorecard = await getScorecard(organization.id, id);
  if (!scorecard) notFound();

  if (scorecard.status === "RUNNING" || scorecard.status === "PENDING") {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Benchmark running" description="This usually takes a few seconds." />
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Scoring {scorecard.agent?.name ?? "your agent"}. Refresh this page in a moment.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (scorecard.status === "FAILED") {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Benchmark failed" />
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="text-sm text-muted-foreground">
              {scorecard.errorMessage ?? "The benchmark could not complete."}
            </p>
            <ButtonLink href="/arena" variant="secondary" size="sm">
              Back to Agent Arena
            </ButtonLink>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overall = scorecard.overallScore ?? 0;
  const categoryScores = parseCategoryScores(scorecard.categoryScores);
  const metrics = (scorecard.metrics ?? {}) as { lowConfidenceCategories?: string[] };
  const lowConfidence = (metrics.lowConfidenceCategories ?? []).filter((c): c is ArenaCategory =>
    (ARENA_CATEGORIES as readonly string[]).includes(c)
  );

  const origin = await getCurrentOrigin();
  const publicUrl =
    scorecard.isPublic && scorecard.publicSlug ? `${origin}/a/${scorecard.publicSlug}` : null;
  const canPublish = canPublishArenaScorecard(role);

  const target = scorecard.challengedFrom?.overallScore ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/arena"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Agent Arena
      </Link>

      <PageHeader
        title={`${scorecard.agent?.name ?? "Agent"} — Scorecard`}
        description={`Aegis Agent Arena benchmark ${scorecard.benchmarkVersion} · ${formatDateTime(
          scorecard.completedAt ?? scorecard.createdAt
        )}`}
      />

      {target != null && (
        <div className="mb-4">
          <BeatBanner myScore={overall} targetScore={target} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <ScoreDial score={overall} />
            <p className="text-center text-sm font-medium text-foreground">
              {challengePrompt(overall)}
            </p>
            <div className="flex w-full flex-col gap-2">
              <ButtonLink href="/arena" size="sm" className="w-full">
                <Swords className="size-3.5" aria-hidden="true" />
                Challenge Another Agent
              </ButtonLink>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Category scores</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBars scores={categoryScores} lowConfidence={lowConfidence} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Share</CardTitle>
          </CardHeader>
          <CardContent>
            {canPublish ? (
              <SharePanel
                scorecardId={scorecard.id}
                isPublic={scorecard.isPublic}
                publicUrl={publicUrl}
                shareText={shareCardText({
                  publicSlug: scorecard.publicSlug ?? "",
                  displayName: scorecard.displayName ?? "Anonymous Agent",
                  overallScore: overall,
                  categoryScores,
                  benchmarkVersion: scorecard.benchmarkVersion,
                  publishedAt: (scorecard.publishedAt ?? scorecard.createdAt).toISOString(),
                })}
                defaultDisplayName={scorecard.displayName ?? "Anonymous Agent"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {scorecard.isPublic
                  ? "This scorecard is public."
                  : "This scorecard is private. Ask an admin to publish it."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What was tested</CardTitle>
          </CardHeader>
          <CardContent>
            {scorecard.scenarioResults.length > 0 ? (
              <ScenarioBreakdown
                results={scorecard.scenarioResults.map((r) => ({
                  id: r.id,
                  category: r.category,
                  scenarioKey: r.scenarioKey,
                  title: r.title,
                  passed: r.passed,
                  score: r.score,
                  detail: r.detail,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No scenario detail recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
