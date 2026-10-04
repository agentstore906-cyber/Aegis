import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LevelBadge, SeverityBadge } from "@/components/scanner/severity";
import { ButtonLink } from "@/components/ui/button";
import { LEVEL_LABEL, SCORE_DISCLAIMER } from "@/lib/scanner/engine";
import { shareText, shareTitle } from "@/lib/scanner/share";
import { getPublicReportBySlug } from "@/lib/scanner/service";
import { getSiteUrl } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

// Shared reports are reachable by link and unfurl in chat/social, but are not offered to search engines.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const report = await getPublicReportBySlug(slug);
  if (!report) return { title: "Report not found", robots: { index: false, follow: false } };

  const title = shareTitle(report.score);
  const description = shareText(report.counts, report.score);
  const url = `${getSiteUrl()}/scan/r/${report.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { type: "website", url, title, description, siteName: "Aegis" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicReportPage({ params }: Props) {
  const { slug } = await params;
  const report = await getPublicReportBySlug(slug);
  if (!report) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <p className="section-label">Aegis · AI agent risk scan</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{shareTitle(report.score)}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A self-assessment of a {report.agentTypeLabel.toLowerCase()} · {new Date(report.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="text-5xl font-semibold tabular-nums tracking-tight text-foreground" aria-label={`Risk score ${report.score} out of 100`}>
            {report.score}
            <span className="text-xl font-normal text-muted-foreground"> / 100</span>
          </p>
          <div>
            <LevelBadge level={report.level} />
            <p className="mt-1 text-xs text-muted-foreground">Risk level: {LEVEL_LABEL[report.level].toUpperCase()}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-foreground">
          {report.counts.high} high-risk {report.counts.high === 1 ? "behavior" : "behaviors"}, {report.counts.medium} medium, {report.counts.protectedAreas} protected {report.counts.protectedAreas === 1 ? "area" : "areas"}.
        </p>
      </section>

      {report.findings.length > 0 && (
        <section className="mt-6" aria-labelledby="pub-findings">
          <h2 id="pub-findings" className="text-lg font-semibold text-foreground">
            Highest risks and recommendations
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {report.findings.map((f) => (
              <li key={f.title} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{f.title}</span>
                  <SeverityBadge severity={f.severity} />
                </div>
                {f.recommendation && <p className="mt-1 text-muted-foreground">Recommended: {f.recommendation}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-xl border border-border-strong bg-surface-muted p-6">
        <h2 className="text-lg font-semibold text-foreground">How risky is your AI agent?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Scan your own agent in about a minute. Free, no account needed.</p>
        <ButtonLink href="/scan?ref=share" size="lg" className="mt-4">
          Scan your AI agent in 60 seconds
        </ButtonLink>
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        This page shows only a score, a risk level, finding titles and one recommendation each. It contains no agent details, configuration or private data. {SCORE_DISCLAIMER}
      </p>
    </div>
  );
}
