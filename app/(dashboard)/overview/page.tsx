import type { Metadata } from "next";
import { Bot, CheckCircle2, AlertTriangle, TrendingUp, ArrowRight, Activity, ShieldBan, ShieldAlert, DollarSign, Plus } from "lucide-react";
import Link from "next/link";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentStats, getAgentsNeedingAttention } from "@/lib/agents/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { getRecentActivity, getOrgSpendSummary, getRiskEventCount } from "@/lib/activity/queries";
import { getPolicyDashboardStats } from "@/lib/policies/repository";
import { getApprovalStats } from "@/lib/approvals/repository";
import { getSecurityStats } from "@/lib/security/repository";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AgentStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { ActivityRow } from "@/components/activity/activity-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { organization, role } = await requireActiveOrganization();

  const [stats, onboardingStatus] = await Promise.all([
    getAgentStats(organization.id),
    getOnboardingStatus(organization.id),
  ]);

  if (stats.total === 0) {
    return (
      <div>
        <PageHeader title="Overview" description={`Welcome to ${organization.name}.`} />
        <OnboardingChecklist status={onboardingStatus} />
        <div className="py-6">
          <EmptyState
            icon={Bot}
            title="No agents connected yet."
            description="Connect your first AI agent to start monitoring runs, costs and activity."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canManageAgents(role) && (
                  <ButtonLink href="/agents/new">
                    <Plus className="size-4" aria-hidden="true" />
                    Connect Agent
                  </ButtonLink>
                )}
                <ButtonLink href="/demo" variant="secondary">
                  Explore Demo
                </ButtonLink>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const [needsAttention, recentActivity, spendCents, riskEvents, policyStats, approvalStats, securityStats] =
    await Promise.all([
      getAgentsNeedingAttention(organization.id),
      getRecentActivity(organization.id, 8),
      getOrgSpendSummary(organization.id),
      getRiskEventCount(organization.id),
      getPolicyDashboardStats(organization.id),
      getApprovalStats(organization.id),
      getSecurityStats(organization.id),
    ]);

  const attentionItems = [
    {
      label: "Pending approvals",
      count: approvalStats.pending,
      href: "/approvals",
      icon: CheckCircle2,
    },
    {
      label: "Open high / critical alerts",
      count: securityStats.highOrCritical,
      href: "/security",
      icon: ShieldAlert,
    },
    {
      label: "Cost anomalies today",
      count: securityStats.costAnomalies,
      href: "/costs",
      icon: DollarSign,
    },
    {
      label: "Blocked actions (24h)",
      count: policyStats.last24h.BLOCK,
      href: "/policies/evaluations?decision=BLOCK",
      icon: ShieldBan,
    },
  ];
  const totalAttentionCount = attentionItems.reduce((sum, item) => sum + item.count, 0);

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`What's happening across ${organization.name}'s agents right now.`}
      />

      <OnboardingChecklist status={onboardingStatus} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Agents" value={String(stats.total)} icon={Bot} />
        <StatCard label="Active" value={String(stats.active)} icon={CheckCircle2} />
        <StatCard
          label="Need attention"
          value={String(stats.needsAttention + stats.paused)}
          icon={AlertTriangle}
          tone={stats.needsAttention > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Pending approvals"
          value={String(approvalStats.pending)}
          icon={CheckCircle2}
          tone={approvalStats.pending > 0 ? "warning" : undefined}
        />
        <StatCard
          label="High-risk events (7d)"
          value={String(riskEvents)}
          icon={AlertTriangle}
          tone={riskEvents > 0 ? "danger" : undefined}
        />
        <StatCard
          label="Spend this month"
          value={formatCurrency(spendCents)}
          icon={TrendingUp}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agents needing attention</CardTitle>
            <Link
              href="/agents?status=NEEDS_ATTENTION"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {needsAttention.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing needs attention"
                  description="All agents are active and behaving normally."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {needsAttention.map((agent) => (
                  <li key={agent.id} className="flex items-center justify-between px-5 py-3">
                    <Link
                      href={`/agents/${agent.slug}`}
                      className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {agent.name}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      <RiskBadge level={agent.riskLevel} />
                      <AgentStatusBadge status={agent.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link
              href="/activity"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentActivity.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  icon={Activity}
                  title="No activity yet"
                  description="Agent actions will appear here as they happen."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentActivity.map((event) => (
                  <ActivityRow
                    key={event.id}
                    timestamp={event.timestamp}
                    agentName={event.agent.name}
                    agentSlug={event.agent.slug}
                    action={event.action}
                    resource={event.resource}
                    status={event.status}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Needs your attention</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {totalAttentionCount === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                icon={CheckCircle2}
                title="Nothing needs you right now"
                description="Pending approvals, high-severity alerts, cost anomalies, and blocked actions will show up here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {attentionItems.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="focus-ring flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted"
                  >
                    <span className="flex items-center gap-2.5 text-foreground">
                      <item.icon
                        className={`size-4 ${item.count > 0 ? "text-warning" : "text-muted-foreground/40"}`}
                        aria-hidden="true"
                      />
                      {item.label}
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={`font-medium tabular-nums ${item.count > 0 ? "text-foreground" : ""}`}>
                        {item.count}
                      </span>
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Control decisions — last 24h</CardTitle>
          <Link
            href="/policies/evaluations"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            View all
            <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center sm:text-left">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-success">{policyStats.last24h.ALLOW}</p>
              <p className="text-xs text-muted-foreground">Allowed</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-warning">
                {policyStats.last24h.REQUIRE_APPROVAL}
              </p>
              <p className="text-xs text-muted-foreground">Approval required</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-danger">{policyStats.last24h.BLOCK}</p>
              <p className="text-xs text-muted-foreground">Blocked</p>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent blocked actions
            </p>
            {policyStats.recentBlocked.length === 0 ? (
              <EmptyState
                icon={ShieldBan}
                title="No blocked actions"
                description="Blocked policy evaluations will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {policyStats.recentBlocked.map((evaluation) => (
                  <li key={evaluation.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/policies/evaluations/${evaluation.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {evaluation.agent.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {evaluation.action}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(evaluation.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {recentActivity[0] && (
        <p className="mt-4 text-xs text-muted-foreground">
          Last event {formatRelativeTime(recentActivity[0].timestamp)}
        </p>
      )}
    </div>
  );
}
