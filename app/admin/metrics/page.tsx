import type { Metadata } from "next";
import { Building2, Bot, ShieldCheck, DollarSign, TrendingUp, CreditCard } from "lucide-react";

import { getPlatformMetrics } from "@/lib/admin/metrics";
import { formatCurrency } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Metrics — Internal" };

export default async function AdminMetricsPage() {
  const metrics = await getPlatformMetrics();
  const activationRate =
    metrics.totalOrganizations === 0 ? 0 : Math.round((metrics.activatedOrganizations / metrics.totalOrganizations) * 100);

  return (
    <div>
      <PageHeader
        title="Metrics"
        description="Real numbers sourced directly from this database — no sample data, no third-party analytics provider is wired up yet."
      />

      <div className="mb-6">
        <Alert tone="info">
          No analytics provider is connected (see lib/analytics/track.ts) and this environment has no real paying
          customers yet — these counts reflect whatever organizations actually exist in this database right now.
          Retention/cohort trends aren&rsquo;t shown here because there isn&rsquo;t enough real history to compute
          them honestly yet — see docs/gtm/metrics.md for the formulas this is expected to grow into.
        </Alert>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Organizations" value={String(metrics.totalOrganizations)} icon={Building2} />
        <StatCard
          label="Activated"
          value={`${metrics.activatedOrganizations} (${activationRate}%)`}
          icon={ShieldCheck}
        />
        <StatCard label="Agents governed" value={String(metrics.totalAgents)} icon={Bot} />
        <StatCard label="Actions evaluated" value={String(metrics.totalGovernedActions)} icon={TrendingUp} />
        <StatCard label="Paid organizations" value={String(metrics.paidOrganizations)} icon={CreditCard} />
        <StatCard label="MRR" value={formatCurrency(metrics.mrrCents)} icon={DollarSign} />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Plan distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {metrics.planDistribution.map((row) => (
              <li key={row.plan} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="capitalize text-foreground">{row.plan}</span>
                <span className="tabular-nums text-muted-foreground">{row.count}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
