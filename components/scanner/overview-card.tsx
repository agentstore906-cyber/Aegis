import Link from "next/link";
import { ScanSearch } from "lucide-react";

import { diffScans, getOrganizationScan, listOrganizationScans } from "@/lib/scanner/service";
import { LevelBadge } from "@/components/scanner/severity";
import { Panel, PanelLink } from "@/components/console/primitives";
import { ButtonLink } from "@/components/ui/button";

/** Command-center card: the latest risk scan, its trend, and the entry point to run a new one. */
export async function RiskScanOverviewCard({ organizationId }: { organizationId: string }) {
  const scans = await listOrganizationScans(organizationId, 4);
  const latest = scans[0];

  if (!latest) {
    return (
      <Panel label="Risk scanner" action={<PanelLink href="/risk-scan">Risk scanner</PanelLink>}>
        <p className="text-sm text-muted-foreground">No risk scan has been run for this workspace.</p>
        <ButtonLink href="/scan?from=dashboard" variant="secondary" size="sm" className="mt-3">
          <ScanSearch className="size-4" aria-hidden="true" />
          Run a new AI Agent Risk Scan
        </ButtonLink>
      </Panel>
    );
  }

  const [latestFull, previousFull] = await Promise.all([getOrganizationScan(organizationId, latest.id), scans[1] ? getOrganizationScan(organizationId, scans[1].id) : Promise.resolve(null)]);
  const diff = latestFull ? diffScans(previousFull?.result ?? null, latestFull.result) : null;
  const trend = [...scans].reverse().map((s) => s.score);

  return (
    <Panel label="Latest risk scan" action={<PanelLink href={`/risk-scan/${latest.id}`}>View setup</PanelLink>} tone={latest.level === "high" || latest.level === "critical" ? "risk" : "neutral"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="num text-2xl font-semibold text-foreground">
          {latest.score}
          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
        </p>
        <LevelBadge level={latest.level} />
        <p className="text-sm text-muted-foreground">
          {latest.highRiskCount} high-risk · {diff?.unresolved.length ?? "—"} unresolved{previousFull ? ` · ${diff?.resolved.length ?? 0} resolved` : ""}
        </p>
      </div>
      {trend.length > 1 && <p className="num mt-2 text-sm text-muted-foreground">Trend: {trend.join(" → ")}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ButtonLink href="/scan?from=dashboard" variant="secondary" size="sm">
          <ScanSearch className="size-4" aria-hidden="true" />
          Run a new AI Agent Risk Scan
        </ButtonLink>
        <Link href="/risk-scan" className="focus-ring rounded-sm text-xs text-muted-foreground hover:text-foreground">
          History
        </Link>
      </div>
    </Panel>
  );
}
