import type { Metadata } from "next";
import { ShieldAlert, AlertTriangle, Download } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listSecurityAlerts, getSecurityStats } from "@/lib/security/repository";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { securityAlertFiltersSchema } from "@/lib/validation/security";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SecurityFilters } from "@/components/security/security-filters";
import { SecurityAlertsTable } from "@/components/security/security-alerts-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Security" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SecurityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = securityAlertFiltersSchema.parse({
    status: typeof raw.status === "string" ? raw.status : undefined,
    severity: typeof raw.severity === "string" ? raw.severity : undefined,
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    type: typeof raw.type === "string" ? raw.type : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [{ alerts, pageCount }, agents, stats] = await Promise.all([
    listSecurityAlerts(organization.id, filters),
    listAllAgentsForOrg(organization.id),
    getSecurityStats(organization.id),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.type) params.set("type", filters.type);
    params.set("page", String(page));
    return `/security?${params.toString()}`;
  };

  const isOpenView = filters.status === undefined || filters.status === "OPEN";

  const exportParams = new URLSearchParams();
  if (filters.status) exportParams.set("status", filters.status);
  if (filters.severity) exportParams.set("severity", filters.severity);
  if (filters.agentId) exportParams.set("agentId", filters.agentId);
  if (filters.type) exportParams.set("type", filters.type);

  return (
    <div>
      <PageHeader
        title="Security"
        description="Behavioral signals worth a human look — deterministic detectors, explainable evidence, no opaque scoring."
        action={
          <ButtonLink href={`/security/export?${exportParams.toString()}`} variant="secondary" size="sm">
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Open alerts" value={String(stats.open)} icon={ShieldAlert} tone={stats.open > 0 ? "warning" : undefined} />
        <StatCard
          label="High / critical"
          value={String(stats.highOrCritical)}
          icon={AlertTriangle}
          tone={stats.highOrCritical > 0 ? "danger" : undefined}
        />
        <StatCard label="Agents with unusual activity" value={String(stats.agentsWithUnusualActivity)} icon={ShieldAlert} />
      </div>

      <div className="mb-4">
        <SecurityFilters agents={agents} />
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={isOpenView ? "No open alerts" : "No alerts match your filters"}
          description={
            isOpenView
              ? "Aegis will flag unusual agent behavior here as its detectors pick it up."
              : "Try adjusting your filters."
          }
          action={
            !isOpenView && (
              <ButtonLink href="/security" variant="secondary" size="sm">
                View open alerts
              </ButtonLink>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <SecurityAlertsTable alerts={alerts} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Detectors, thresholds, and severity rules are documented in{" "}
        <code>docs/security-intelligence.md</code>.
      </p>
    </div>
  );
}
