import type { Metadata } from "next";
import Link from "next/link";
import { ScanSearch } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { hasCapability } from "@/lib/rbac/capabilities";
import { diffScans, getOrganizationScan, listOrganizationScans } from "@/lib/scanner/service";
import { agentTypeLabel } from "@/components/scanner/report";
import { LevelBadge } from "@/components/scanner/severity";
import { PageHeader } from "@/components/dashboard/page-header";
import { Metric, Panel } from "@/components/console/primitives";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Risk scanner", robots: { index: false, follow: false } };

export default async function RiskScanPage() {
  const { organization, role } = await requireActiveOrganization();

  if (!hasCapability(role, "view_security")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Risk scanner" />
        <EmptyState icon={ScanSearch} title="Your role can’t view risk scans." description="Risk scans describe how an agent is configured, so they are limited to members who can view security information." hint="Ask an owner or admin if you need access." />
      </div>
    );
  }

  const scans = await listOrganizationScans(organization.id, 20);
  const runButton = (
    <ButtonLink href="/scan?from=dashboard">
      <ScanSearch className="size-4" aria-hidden="true" />
      Run a new AI Agent Risk Scan
    </ButtonLink>
  );

  if (scans.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Risk scanner" description="Self-assessments of how your agents are configured." />
        <EmptyState
          eyebrow="Risk scans"
          icon={ScanSearch}
          title="No risk scans in this workspace yet."
          description="A scan takes about a minute and produces an explainable report on permissions, autonomy, data access and missing controls."
          hint="Scans you ran before signing up appear here once you sign in on the same browser."
          action={runButton}
        />
      </div>
    );
  }

  const latest = scans[0]!;
  const previous = scans[1];
  const [latestFull, previousFull] = await Promise.all([getOrganizationScan(organization.id, latest.id), previous ? getOrganizationScan(organization.id, previous.id) : Promise.resolve(null)]);
  const diff = latestFull ? diffScans(previousFull?.result ?? null, latestFull.result) : null;
  const trend = [...scans].slice(0, 6).reverse();

  return (
    <div className="space-y-6">
      <PageHeader title="Risk scanner" description="Self-assessments of how your agents are configured. Re-scan after you change an agent to see what improved." action={runButton} />

      <section aria-label="Latest scan" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Latest risk score" value={`${latest.score} / 100`} />
        <Metric label="High-risk behaviors" value={latest.highRiskCount} />
        <Metric label="Unresolved findings" value={diff?.unresolved.length ?? "—"} />
        <Metric label="Resolved since last scan" value={previousFull ? (diff?.resolved.length ?? 0) : "—"} />
      </section>

      <Panel label="Risk history" action={<LevelBadge level={latest.level} />}>
        {trend.length > 1 ? (
          <p className="num text-lg text-foreground" aria-label={`Risk score history: ${trend.map((s) => s.score).join(", then ")}`}>
            {trend.map((s) => s.score).join("  →  ")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Run another scan after making changes to see how your score moves over time.</p>
        )}
        {diff && previousFull && (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {diff.resolved.length > 0 && <li>Resolved: {diff.resolved.map((f) => f.title).join(", ")}</li>}
            {diff.improved.length > 0 && <li>Reduced in severity: {diff.improved.map((f) => f.title).join(", ")}</li>}
            {diff.introduced.length > 0 && <li>New: {diff.introduced.map((f) => f.title).join(", ")}</li>}
            {diff.resolved.length + diff.improved.length + diff.introduced.length === 0 && <li>No change in findings since the previous scan.</li>}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">“Resolved” means a finding present in the previous scan is absent from the latest one, based on the answers given — not independently verified.</p>
      </Panel>

      <Panel label="All scans" flush>
        <ul className="divide-y divide-border">
          {scans.map((s) => (
            <li key={s.id}>
              <Link href={`/risk-scan/${s.id}`} className="focus-ring flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-muted">
                <span className="text-foreground">
                  {agentTypeLabel(s.agentType, null)} <span className="text-muted-foreground">· {formatDateTime(s.createdAt)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num text-muted-foreground">
                    {s.highRiskCount} high · {s.mediumCount} medium
                  </span>
                  <span className="num font-medium text-foreground">{s.score}/100</span>
                  <LevelBadge level={s.level} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
