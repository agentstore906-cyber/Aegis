import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Bot, CheckCircle2, DollarSign, Plus, ShieldAlert, ShieldBan, Siren } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentStats, getAgentsNeedingAttention } from "@/lib/agents/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { getRecentActivity, getOrgSpendSummary, getOrgEventCount } from "@/lib/activity/queries";
import { getPolicyDashboardStats } from "@/lib/policies/repository";
import { getApprovalStats, getOrgApprovalCount } from "@/lib/approvals/repository";
import { getSecurityStats, getHighRiskAgentsSummary, listRecentAnomalies } from "@/lib/security/repository";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { getAllBudgetStatuses } from "@/lib/costs/budgets";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { getInventory } from "@/lib/control/inventory";
import { searchIncidents } from "@/lib/incidents/service";
import { getRiskControlSettings } from "@/lib/risk/settings";
import { DECISION } from "@/lib/ui/vocabulary";
import { formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Metric, Panel, PanelLink, StateLine } from "@/components/console/primitives";
import { AgentStatusBadge, RiskBadge, SecurityAlertSeverityBadge } from "@/components/dashboard/status-badges";
import { ActivityRow } from "@/components/activity/activity-row";
import { LiveActivityRefresh } from "@/components/activity/live-activity-refresh";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { RiskScanOverviewCard } from "@/components/scanner/overview-card";
import { OnboardingChecklist, STEPS, type OnboardingStepConfig } from "@/components/dashboard/onboarding-checklist";

export const metadata: Metadata = { title: "Command center" };

const NEW_ORG_STEPS: OnboardingStepConfig[] = [
  { key: "agentConnected", label: "Connect your first agent", href: "/agents/new" },
  { key: "firstEventReceived", label: "Send your first event", href: "/developers/quickstart" },
  { key: "firstPolicyCreated", label: "Create your first policy", href: "/policies/new" },
  { key: "approvalWorkflowUsed", label: "Test an approval", href: "/approvals" },
];

/**
 * What the configured risk-control mode means, in words that match what Aegis actually does
 * (it returns decisions; it is not in the agent's data path — docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md).
 */
const RISK_MODE = {
  OBSERVE: { label: "Observe", tone: "system", text: "Risk is assessed and recorded on every decision. It does not change the decision an agent receives." },
  APPROVAL_REQUIRED: { label: "Approval required", tone: "approval", text: "Requests assessed as medium or high risk are returned as awaiting approval." },
  ENFORCE: { label: "Enforce", tone: "blocked", text: "Requests assessed as high risk are returned as BLOCK. The agent's integration must honor the decision." },
} as const;

export default async function OverviewPage() {
  const { organization, role, user } = await requireActiveOrganization();
  const canSecurity = canViewSecurityAlerts(role);

  const [stats, onboardingStatus] = await Promise.all([getAgentStats(organization.id), getOnboardingStatus(organization.id)]);

  // ── No agents: say exactly what is empty, why, and the next step. No placeholder figures. ──
  if (stats.total === 0) {
    const [eventCount, approvalCount, spendCents] = await Promise.all([
      getOrgEventCount(organization.id),
      getOrgApprovalCount(organization.id),
      getOrgSpendSummary(organization.id),
    ]);
    const hasAnyRecords = eventCount > 0 || approvalCount > 0 || spendCents > 0;

    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Command center" description={`${organization.name} has no agents yet.`} />
        <EmptyState
          eyebrow="Agent fleet"
          icon={Bot}
          title="No agents are registered."
          description="Aegis decides and records for agents you register. Until one exists, there is no fleet to show, no decisions to review and no risk to assess."
          hint="Register an agent, then send its first event or ask for its first decision from the quickstart."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {canManageAgents(role) ? (
                <ButtonLink href="/agents/new">
                  <Plus className="size-4" aria-hidden="true" />
                  Register your first agent
                </ButtonLink>
              ) : (
                <p className="text-xs text-muted-foreground">Ask an owner or admin to register an agent.</p>
              )}
              <ButtonLink href="/developers/quickstart" variant="secondary">
                Read the quickstart
              </ButtonLink>
              <ButtonLink href="/demo" variant="ghost">
                View sample-data demo
              </ButtonLink>
            </div>
          }
        />
        {hasAnyRecords && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Earlier records remain: {eventCount} activity events, {approvalCount} approvals, {formatCurrency(spendCents)} recorded spend.
          </p>
        )}
        {canSecurity && (
          <div className="mt-8">
            <RiskScanOverviewCard organizationId={organization.id} />
          </div>
        )}
        <div className="mt-8">
          <OnboardingChecklist status={onboardingStatus} steps={NEW_ORG_STEPS} title="Setup steps" />
        </div>
      </div>
    );
  }

  const actor = { organizationId: organization.id, userId: user.id, role };
  const [needsAttention, recentActivity, spendCents, policyStats, approvalStats, budgetStatuses, risk, security, inventory, incidents] = await Promise.all([
    getAgentsNeedingAttention(organization.id),
    getRecentActivity(organization.id, 8),
    getOrgSpendSummary(organization.id),
    getPolicyDashboardStats(organization.id),
    getApprovalStats(organization.id),
    getAllBudgetStatuses(organization.id),
    canSecurity ? getRiskControlSettings(organization.id) : Promise.resolve(null),
    canSecurity
      ? Promise.all([getSecurityStats(organization.id), getHighRiskAgentsSummary(organization.id, 5), listRecentAnomalies(organization.id, 5)])
      : Promise.resolve(null),
    canSecurity ? getInventory(organization.id, { pageSize: 1 }) : Promise.resolve(null),
    canSecurity ? searchIncidents(actor, { status: ["OPEN", "INVESTIGATING"], pageSize: 5 }) : Promise.resolve(null),
  ]);

  const [securityStats, highRiskAgents, recentAnomalies] = security ?? [null, [], []];
  const exceededBudgets = budgetStatuses.filter((s) => s.exceeded).length;
  const last24h = policyStats.last24h;
  const decisions24h = last24h.ALLOW + last24h.ALERT + last24h.REQUIRE_APPROVAL + last24h.BLOCK;

  // The queue of things that need a person. Only non-zero items are listed.
  const attention = [
    { label: "Approvals awaiting a decision", count: approvalStats.pending, href: "/approvals", icon: CheckCircle2, tone: "approval" as const },
    ...(securityStats
      ? [
          { label: "Open high or critical security alerts", count: securityStats.highOrCritical, href: "/security", icon: ShieldAlert, tone: "risk" as const },
          { label: "Open cost anomalies", count: securityStats.costAnomalies, href: "/security", icon: DollarSign, tone: "warning" as const },
        ]
      : []),
    ...(incidents ? [{ label: "Open or investigating incidents", count: incidents.total, href: "/incidents", icon: Siren, tone: "risk" as const }] : []),
    { label: "Budgets exceeded", count: exceededBudgets, href: "/costs", icon: DollarSign, tone: "warning" as const },
  ].filter((i) => i.count > 0);

  const isPersonal = organization.accountType === "PERSONAL";
  const checklistSteps = isPersonal ? STEPS.filter((step) => step.key !== "teammateInvited") : STEPS;
  const summary = inventory?.summary;
  const mode = risk ? RISK_MODE[risk.mode] : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Command center" description={`The current state of ${organization.name}'s agents, decisions and risk.`} />

      <OnboardingChecklist status={onboardingStatus} steps={checklistSteps} />

      {canSecurity && <RiskScanOverviewCard organizationId={organization.id} />}

      {/* Headline figures: every value is a count or sum read from this organization's records. */}
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Agents" value={stats.total} caption={`${stats.active} active`} href="/agents" />
        <Metric
          label="Need attention"
          value={stats.needsAttention + stats.paused + stats.stopped}
          caption="needs attention, paused or stopped"
          tone={stats.needsAttention + stats.stopped > 0 ? "warning" : "neutral"}
          href="/agents?status=NEEDS_ATTENTION"
        />
        <Metric label="Awaiting approval" value={approvalStats.pending} tone={approvalStats.pending > 0 ? "approval" : "neutral"} href="/approvals" caption="pending human decision" />
        {securityStats ? (
          <Metric label="High / critical alerts" value={securityStats.highOrCritical} tone={securityStats.highOrCritical > 0 ? "risk" : "neutral"} href="/security" caption="open" />
        ) : (
          <Metric label="Decisions (24h)" value={decisions24h} href="/policies/evaluations" caption="returned by Aegis" />
        )}
        <Metric label="Blocked (24h)" value={last24h.BLOCK} tone={last24h.BLOCK > 0 ? "blocked" : "neutral"} href="/policies/evaluations?decision=BLOCK" caption="Aegis returned BLOCK" />
        <Metric label="Spend this month" value={formatCurrency(spendCents)} href="/costs" caption="recorded from agent events" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel label="Requires attention" tone={attention.length > 0 ? "warning" : "neutral"} className="lg:col-span-2" flush>
          {attention.length === 0 ? (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="Nothing is waiting on a person."
              description="No approvals are pending, and there are no open high-severity alerts, incidents or exceeded budgets."
              hint="Items appear here the moment one of those conditions is true."
            />
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="focus-ring flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-muted">
                    <StateLine tone={item.tone}>
                      <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {item.label}
                    </StateLine>
                    <span className="num text-foreground">{item.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {mode && risk ? (
          <Panel label="Risk control" action={<PanelLink href="/risk-control">Configure</PanelLink>}>
            <StateLine tone={mode.tone}>
              Mode: <strong className="font-medium">{mode.label}</strong>
            </StateLine>
            <p className="mt-2 text-sm text-muted-foreground">{mode.text}</p>
            {risk.globallyDisabled && <p className="mt-2 text-xs text-warning">Risk control is disabled globally by the operator; the configured mode is not applied.</p>}
          </Panel>
        ) : (
          <Panel label="Decisions · last 24 h" action={<PanelLink href="/policies/evaluations">All decisions</PanelLink>}>
            <p className="text-sm text-muted-foreground">{decisions24h} returned by Aegis.</p>
          </Panel>
        )}
      </div>

      {summary && (
        <Panel label="Integration coverage" action={<PanelLink href="/control">Control plane</PanelLink>}>
          <p className="mb-3 text-xs text-muted-foreground">
            Aegis returns decisions and keeps an audit trail. Whether an action is actually held back depends on each agent asking before it acts. Last {summary.windowDays} days.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Report activity only</dt>
              <dd className="num text-lg text-foreground">{summary.observeOnly}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Have no permission granted</dt>
              <dd className="num text-lg text-foreground">{summary.nothingGranted}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ran despite a decision</dt>
              <dd className="num text-lg text-foreground">{summary.ranDespiteDecision}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">With unusual behavior</dt>
              <dd className="num text-lg text-foreground">{summary.unusualBehavior}</dd>
            </div>
          </dl>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel label="Decisions · last 24 h" action={<PanelLink href="/policies/evaluations">All decisions</PanelLink>}>
          {decisions24h === 0 ? (
            <EmptyState
              compact
              icon={ShieldBan}
              title="Aegis has returned no decisions in the last 24 hours."
              description="Decisions are made when an agent asks Aegis whether an action is allowed. Agents that only report activity produce records, not decisions."
              hint="Send a request from the policy tester, or integrate the evaluate call in the agent."
              action={
                <ButtonLink href="/policies/test" variant="secondary" size="sm">
                  Open policy tester
                </ButtonLink>
              }
            />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(["ALLOW", "ALERT", "REQUIRE_APPROVAL", "BLOCK"] as const).map((d) => (
                  <div key={d}>
                    <dt className="text-xs text-muted-foreground">{DECISION[d].label}</dt>
                    <dd className="num text-2xl font-semibold text-foreground">{last24h[d]}</dd>
                  </div>
                ))}
              </dl>
              {policyStats.recentBlocked.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="section-label mb-1">Most recent blocked</p>
                  <ul className="divide-y divide-border">
                    {policyStats.recentBlocked.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          <Link href={`/policies/evaluations/${e.id}`} className="font-medium text-foreground hover:underline">
                            {e.agent.name}
                          </Link>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{e.action}</span>
                        </span>
                        <time className="num shrink-0 text-xs text-muted-foreground" dateTime={e.createdAt.toISOString()}>
                          {formatDateTime(e.createdAt)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel label="Recent activity" action={<PanelLink href="/activity">All activity</PanelLink>} flush>
          {recentActivity.length === 0 ? (
            <EmptyState
              compact
              icon={Activity}
              title="No activity has been recorded."
              description="Activity appears when a registered agent sends events to Aegis."
              hint="Use the quickstart to send a first event."
              action={
                <ButtonLink href="/developers/quickstart" variant="secondary" size="sm">
                  Developer quickstart
                </ButtonLink>
              }
            />
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
                  toolName={event.toolName}
                  description={event.description}
                  status={event.status}
                  source={event.source}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel label="Agents needing attention" action={<PanelLink href="/agents?status=NEEDS_ATTENTION">All agents</PanelLink>} flush>
          {needsAttention.length === 0 ? (
            <EmptyState compact icon={Bot} title="No agent is flagged." description="Every agent is active; none is paused, stopped or marked as needing attention." />
          ) : (
            <ul className="divide-y divide-border">
              {needsAttention.map((agent) => (
                <li key={agent.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <Link href={`/agents/${agent.slug}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                    {agent.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <RiskBadge level={agent.riskLevel} />
                    <AgentStatusBadge status={agent.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {incidents ? (
          <Panel label="Open incidents" action={<PanelLink href="/incidents">All incidents</PanelLink>} flush>
            {incidents.incidents.length === 0 ? (
              <EmptyState
                compact
                icon={Siren}
                title="No incident is open."
                description="Incidents are opened from security alerts or manually when something needs investigation."
              />
            ) : (
              <ul className="divide-y divide-border">
                {incidents.incidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/incidents/${i.id}`} className="focus-ring block px-4 py-3 hover:bg-surface-muted">
                      <span className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium text-foreground">
                          INC-{i.number} {i.title}
                        </span>
                        <RiskBadge level={i.severity} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {i.agent.name} · opened {formatRelativeTime(i.openedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <Panel label="Spend" action={<PanelLink href="/costs">Costs</PanelLink>}>
            <p className="text-sm text-muted-foreground">{formatCurrency(spendCents)} recorded this month from agent-reported usage.</p>
          </Panel>
        )}
      </div>

      {securityStats && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel label="Agents with open high-severity alerts" action={<PanelLink href="/security">Security alerts</PanelLink>} flush>
            {highRiskAgents.length === 0 ? (
              <EmptyState compact icon={ShieldAlert} title="No agent has an open high-severity alert." description="Agents with open high or critical alerts are listed here, with the number of alerts." />
            ) : (
              <ul className="divide-y divide-border">
                {highRiskAgents.map(({ agent, highOrCriticalAlertCount, criticalAlertCount }) => (
                  <li key={agent.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/agents/${agent.slug}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                      {agent.name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <RiskBadge level={agent.riskLevel} />
                      <span className="text-xs text-muted-foreground">
                        {criticalAlertCount > 0 ? `${criticalAlertCount} critical` : `${highOrCriticalAlertCount} high`} alert{highOrCriticalAlertCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel label="Recent security alerts" action={<PanelLink href="/security">All alerts</PanelLink>} flush>
            {recentAnomalies.length === 0 ? (
              <EmptyState compact icon={Activity} title="No security alert has been raised." description="Alerts are raised from detectors over agent activity: volume, cost, data access and failure patterns." />
            ) : (
              <ul className="divide-y divide-border">
                {recentAnomalies.map((alert) => (
                  <li key={alert.id}>
                    <Link href={`/security/${alert.id}`} className="focus-ring block px-4 py-3 hover:bg-surface-muted">
                      <span className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium text-foreground">{alert.title}</span>
                        <SecurityAlertSeverityBadge severity={alert.severity} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {alert.agent.name} · {formatRelativeTime(alert.lastSeenAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <LiveActivityRefresh intervalMs={15000} />
    </div>
  );
}
