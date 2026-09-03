import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Swords } from "lucide-react";

import { getPublicScorecardBySlug, getPublicScorecardId } from "@/lib/arena/queries";
import { trackArenaEvent } from "@/lib/arena/analytics";
import { challengePrompt, shareCardText, topCategories } from "@/lib/arena/share";
import { getSiteUrl } from "@/lib/seo";
import { ARENA_CATEGORY_LABELS, ARENA_CATEGORIES } from "@/lib/arena/types";
import { ScoreDial } from "@/components/arena/score-dial";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await getPublicScorecardBySlug(slug);
  if (!card) {
    return { title: "Scorecard not found", robots: { index: false, follow: false } };
  }

  const title = `${card.displayName} scored ${card.overallScore}/1000 — Aegis Agent Arena`;
  const description = shareCardText(card);
  const url = `${getSiteUrl()}/a/${card.publicSlug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: "Aegis Agent Arena",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicScorecardPage({ params }: Props) {
  const { slug } = await params;
  const [card, scorecardId] = await Promise.all([
    getPublicScorecardBySlug(slug),
    getPublicScorecardId(slug),
  ]);
  if (!card) notFound();

  await trackArenaEvent("scorecard_viewed", {
    scorecardId: scorecardId ?? undefined,
    properties: { slug: card.publicSlug },
  });

  const tops = topCategories(card.categoryScores);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Aegis Agent Arena
        </span>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          What is Aegis?
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center">
        <div className="w-full rounded-2xl border border-border bg-surface p-8">
          <div className="flex flex-col items-center gap-6">
            <ScoreDial score={card.overallScore} />
            <p className="text-lg font-medium text-foreground">{card.displayName}</p>

            <ul className="grid w-full max-w-sm grid-cols-1 gap-2">
              {ARENA_CATEGORIES.map((category) => (
                <li
                  key={category}
                  className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">{ARENA_CATEGORY_LABELS[category]}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {card.categoryScores[category]}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-col items-center gap-3">
              <p className="text-center text-xl font-semibold text-foreground">
                {challengePrompt(card.overallScore)}
              </p>
              <Link
                href={`/a/${card.publicSlug}/challenge`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
              >
                <Swords className="size-4" aria-hidden="true" />
                Challenge This Agent
              </Link>
              <p className="text-xs text-muted-foreground">
                Strongest: {tops.map((t) => t.label).join(", ")}
              </p>
            </div>
          </div>
        </div>

        <p className="mt-6 max-w-md text-center text-xs text-muted-foreground">
          This scorecard shows a benchmark score and category breakdown only. It exposes no agent
          name, model, configuration, or activity. Benchmark {card.benchmarkVersion}.
        </p>
      </main>
    </div>
  );
}
