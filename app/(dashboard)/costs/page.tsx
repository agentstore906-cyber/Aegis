import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Download } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewCosts } from "@/lib/costs/authorization";
import {
  getSpendSummary,
  getSpendByAgent,
  getSpendByProvider,
  getSpendByModel,
  getSpendByTaskType,
  getSpendByTeam,
} from "@/lib/costs/queries";
import { listSecurityAlertsByType } from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES } from "@/lib/security/types";
import { formatCurrency } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AgentSpendTable } from "@/components/costs/agent-spend-table";
import { SpendBreakdownList } from "@/components/costs/spend-breakdown-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Costs" };

export default async function CostsPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewCosts(role)) notFound();

  const [summary, byAgent, byProvider, byModel, byTaskType, byTeam, anomalies] = await Promise.all([
    getSpendSummary(organization.id),
    getSpendByAgent(organization.id),
    getSpendByProvider(organization.id),
    getSpendByModel(organization.id),
    getSpendByTaskType(organization.id),
    getSpendByTeam(organization.id),
    listSecurityAlertsByType(organization.id, SECURITY_ALERT_TYPES.COST_SPIKE, 5),
  ]);

  const highestCostAgent = byAgent[0] ?? null;
  const changeTone = summary.changePercent !== null && summary.changePercent > 0 ? "danger" : undefined;

  return (
    <div>
      <PageHeader
        title="Costs"
        description={`AI spend across ${organization.name}'s agents.`}
        action={
          <ButtonLink href="/costs/export" variant="secondary" size="sm">
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Spend this month" value={formatCurrency(summary.thisMonthCents)} icon={DollarSign} />
        <StatCard
          label="vs. last month"
          value={summary.changePercent === null ? "—" : `${summary.changePercent > 0 ? "+" : ""}${Math.round(summary.changePercent)}%`}
          icon={summary.changePercent !== null && summary.changePercent < 0 ? TrendingDown : TrendingUp}
          tone={changeTone}
        />
        <StatCard label="Spend today" value={formatCurrency(summary.todayCents)} icon={DollarSign} />
        <StatCard label="Highest-cost agent" value={highestCostAgent?.agentName ?? "—"} icon={TrendingUp} />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Cost anomalies</CardTitle>
          <Link href="/security?type=COST_SPIKE" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            View in Security
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {anomalies.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState icon={AlertTriangle} title="No cost anomalies" description="Unusually high daily spend for an agent will show up here." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {anomalies.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/security/${alert.id}`} className="min-w-0 truncate text-foreground hover:underline">
                    {alert.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{alert.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>By agent — this month</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {byAgent.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState icon={DollarSign} title="No spend recorded yet" description="Cost data from agent activity will appear here." />
            </div>
          ) : (
            <AgentSpendTable agents={byAgent} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By provider</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendBreakdownList items={byProvider} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By model</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendBreakdownList items={byModel} />
          </CardContent>
        </Card>

        {byTeam.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>By team</CardTitle>
            </CardHeader>
            <CardContent>
              <SpendBreakdownList items={byTeam} />
            </CardContent>
          </Card>
        )}

        {byTaskType.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>By task type</CardTitle>
            </CardHeader>
            <CardContent>
              <SpendBreakdownList items={byTaskType} />
            </CardContent>
          </Card>
        )}
      </div>

      {byTeam.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          No agents have a team assigned yet — assign one from an agent&rsquo;s edit page or{" "}
          <ButtonLink href="/settings/organization" variant="ghost" size="sm" className="h-auto p-0 underline">
            manage teams in Settings
          </ButtonLink>
          .
        </p>
      )}
    </div>
  );
}
