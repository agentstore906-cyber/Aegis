import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Lock, SearchX } from "lucide-react";

import { agentTypeLabel, ScanReport } from "@/components/scanner/report";
import { ConversionPanel } from "@/components/scanner/conversion-panel";
import { SharePanel } from "@/components/scanner/share-panel";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import { resolveViewer } from "@/lib/scanner/http";
import { getScanForViewer } from "@/lib/scanner/service";

// A private report: never indexed, never cached.
export const metadata: Metadata = { title: "Your AI agent security report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ScanReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await resolveViewer();
  const lookup = await getScanForViewer(id, viewer);

  if (lookup.status === "expired") {
    return (
      <Shell>
        <EmptyState
          icon={Clock}
          title="This report has expired."
          description="Reports from anonymous scans are kept for 30 days. Nothing from the scan is kept beyond that."
          hint="Run the scan again — it takes about a minute."
          action={<ButtonLink href="/scan">Run a new scan</ButtonLink>}
        />
      </Shell>
    );
  }

  if (lookup.status !== "ok") {
    // Deliberately one message for "doesn't exist" and "isn't yours": ids are not an oracle.
    return (
      <Shell>
        <EmptyState
          icon={viewer.sessionHash ? SearchX : Lock}
          title="We can’t show this report in this browser."
          description="Private reports are tied to the browser session that created them. It may have been cleared, opened on another device, or the link may be wrong."
          hint="If this is your report, sign in to the account it was saved to. Otherwise, run the scan again."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/scan">Run a new scan</ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary">
                Sign in
              </ButtonLink>
            </div>
          }
        />
      </Shell>
    );
  }

  const { scan } = lookup;
  await trackScannerEvent("report_viewed", { visitorHash: viewer.sessionHash, scanId: scan.id, organizationId: scan.organizationId, properties: { level: scan.result.level, highRisk: scan.result.counts.high } });

  return (
    <Shell wide>
      <div className="space-y-10">
        <ScanReport result={scan.result} agentLabel={agentTypeLabel(scan.agentType, scan.agentLabel)} createdAt={scan.createdAt} />
        {scan.expiresAt && (
          <p className="text-xs text-muted-foreground">
            This report is kept for 30 days from your scan. <Link href={`/scan/connect/${scan.id}`} className="font-medium text-foreground underline underline-offset-2">Connect it to Aegis</Link> to keep it.
          </p>
        )}
        <ConversionPanel scanId={scan.id} highRisk={scan.result.counts.high} mediumRisk={scan.result.counts.medium} />
        <SharePanel scanId={scan.id} score={scan.result.score} highRisk={scan.result.counts.high} initialPath={scan.isPublic && scan.publicSlug ? `/scan/r/${scan.publicSlug}` : null} />
        <p className="text-center text-sm text-muted-foreground">
          Changed something? <Link href="/scan" className="font-medium text-foreground underline underline-offset-2">Scan again</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`mx-auto px-6 py-12 sm:py-16 ${wide ? "max-w-3xl" : "max-w-xl"}`}>{children}</div>;
}
