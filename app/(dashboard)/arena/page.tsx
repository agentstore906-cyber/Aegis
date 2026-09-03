import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Swords, Trophy, Plus } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canRunArenaBenchmark } from "@/lib/arena/authorization";
import { listAgentsForArena, listScorecards } from "@/lib/arena/queries";
import { getArenaViralMetrics } from "@/lib/arena/metrics";
import { getPendingChallenge } from "@/lib/arena/challenge";
import { trackArenaEvent } from "@/lib/arena/analytics";
import { formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RunBenchmarkForm } from "@/components/arena/run-benchmark-form";
import { ChallengeBanner } from "@/components/arena/challenge-banner";

export const metadata: Metadata = {
  title: "Agent Arena",
  description: "Put your agent to the test. Benchmark it, score it, and challenge another agent.",
};

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 800) return "success";
  if (score >= 520) return "warning";
  return "danger";
}

export default async function ArenaPage() {
  const { organization, role } = await requireActiveOrganization();
  const canRun = canRunArenaBenchmark(role);

  const [agents, scorecards, metrics, pendingChallenge] = await Promise.all([
    listAgentsForArena(organization.id),
    listScorecards(organization.id, 15),
    getArenaViralMetrics(organization.id),
    getPendingChallenge(),
  ]);

  await trackArenaEvent("arena_viewed", { organizationId: organization.id });

  const hasAgents = agents.length > 0;

  if (pendingChallenge) {
    await trackArenaEvent("challenge_clicked", {
      organizationId: organization.id,
      scorecardId: pendingChallenge.sourceScorecardId,
    });
    if (!hasAgents) {
      await trackArenaEvent("connect_agent_from_challenge", {
        organizationId: organization.id,
        scorecardId: pendingChallenge.sourceScorecardId,
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Agent Arena"
        description="Put your agent to the test — a real benchmark of the agent you already run through Aegis."
      />

      {pendingChallenge && (
        <ChallengeBanner
          targetDisplayName={pendingChallenge.targetDisplayName}
          targetScore={pendingChallenge.targetScore}
        />
      )}

      {!hasAgents ? (
        <EmptyState
          icon={Bot}
          title="No agent connected yet"
          description="Agent Arena benchmarks an agent you've already connected to Aegis. Connect one to get started — it takes a minute."
          action={
            <ButtonLink href="/agents/new" size="sm">
              <Plus className="size-3.5" aria-hidden="true" />
              Connect Agent
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-6">
          {metrics.completedScorecards > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat label="Benchmarks run" value={String(metrics.completedScorecards)} />
              <MiniStat
                label="Challenge rate"
                value={formatPct(metrics.challengeRate)}
                hint="challenges started per public scorecard view"
              />
              <MiniStat
                label="Challenge conversion"
                value={formatPct(metrics.challengeConversion)}
                hint="challengers who ran a benchmark"
              />
              <MiniStat
                label="Viral K-factor"
                value={metrics.viralKFactor.toFixed(2)}
                hint="new benchmarked agents per public scorecard"
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Your agents</CardTitle>
              <ButtonLink href="/agents/new" variant="secondary" size="sm">
                <Plus className="size-3.5" aria-hidden="true" />
                Connect Agent
              </ButtonLink>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {agents.map((agent) => (
                  <li
                    key={agent.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/agents/${agent.slug}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {agent.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {agent.modelProvider} {agent.modelName} · {agent.eventCount} events observed
                        {agent.lastActiveAt
                          ? ` · active ${formatRelativeTime(agent.lastActiveAt)}`
                          : " · no activity yet"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {agent.latestScorecard?.overallScore != null && (
                        <Link href={`/arena/${agent.latestScorecard.id}`}>
                          <Badge tone={scoreTone(agent.latestScorecard.overallScore)}>
                            {agent.latestScorecard.overallScore} / 1000
                          </Badge>
                        </Link>
                      )}
                      {canRun ? (
                        <RunBenchmarkForm
                          agentSlug={agent.slug}
                          size="sm"
                          label={agent.latestScorecard ? "Re-test" : "Test My Agent"}
                          variant={agent.latestScorecard ? "secondary" : "primary"}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent scorecards</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {scorecards.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    icon={Trophy}
                    title="No scorecards yet"
                    description="Run a benchmark on one of your agents to generate its first score."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {scorecards.map((sc) => (
                    <li
                      key={sc.id}
                      className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm"
                    >
                      <div className="min-w-0">
                        <Link href={`/arena/${sc.id}`} className="font-medium text-foreground hover:underline">
                          {sc.agent?.name ?? "Agent"}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {sc.status === "COMPLETED"
                            ? formatRelativeTime(sc.completedAt ?? sc.createdAt)
                            : sc.status.toLowerCase()}
                          {sc.challengedFromId ? " · from a challenge" : ""}
                          {sc.isPublic ? " · public" : ""}
                        </p>
                      </div>
                      {sc.status === "COMPLETED" && sc.overallScore != null ? (
                        <Badge tone={scoreTone(sc.overallScore)}>{sc.overallScore} / 1000</Badge>
                      ) : sc.status === "FAILED" ? (
                        <Badge tone="danger">Failed</Badge>
                      ) : (
                        <Badge tone="neutral">
                          <Swords className="size-3" aria-hidden="true" /> Running
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
