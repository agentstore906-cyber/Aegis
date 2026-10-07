import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Wrench, ShieldCheck, ShieldAlert, DollarSign, Plus, Activity as ActivityIcon, CheckCircle2 } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { prisma } from "@/lib/db";
import { getCurrentOrigin } from "@/lib/request-origin";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getAgentActivity, getAgentActivityStatusCounts } from "@/lib/activity/queries";
import { formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";
import { canManageAgentPermissions } from "@/lib/policies/authorization";
import { canManageAgents } from "@/lib/agents/authorization";
import {
  getAgentPermissionSummary,
  listAgentPermissions,
  listPoliciesForAgent,
} from "@/lib/policies/repository";
import { listApprovalsForAgent } from "@/lib/approvals/repository";
import { AgentScanPanel } from "@/components/security/agent-scan-panel";
import { getLatestAgentScan } from "@/lib/scanner/agent-scan";
import { scanEligibility } from "@/lib/scanner/agent-scan-model";
import { getSecurityStatsForAgent, listSecurityAlertsForAgent } from "@/lib/security/repository";
import { getBehaviorProfile, listDeviations } from "@/lib/behavior/queries";
import { getOpenAlertCounts } from "@/lib/agents/list-signals";
import { getTrust, listTrustHistory } from "@/lib/trust/queries";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { canViewActionGraph } from "@/lib/graph/authorization";
import { getRunGraph, listRuns } from "@/lib/graph/queries";
import { getAgentControlView } from "@/lib/control/agent-view";
import { getCostPerSuccessfulTaskForAgent } from "@/lib/costs/queries";
import type { ConnectorCapabilities } from "@/lib/connectors/types";

import { StateLine, type PanelTone } from "@/components/console/primitives";
import { AgentTabs } from "@/components/agents/agent-tabs";
import { AgentStatusToggle } from "@/components/agents/agent-status-toggle";
import {
  AgentStatusBadge,
  ApprovalStatusBadge,
  SecurityAlertSeverityBadge,
  SecurityAlertStatusBadge,
} from "@/components/dashboard/status-badges";
import { ActivityRow } from "@/components/activity/activity-row";
import { LiveActivityRefresh } from "@/components/activity/live-activity-refresh";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PermissionsTable } from "@/components/policies/permissions-table";
import { AgentPoliciesList } from "@/components/policies/agent-policies-list";
import { AgentConnectPanel } from "@/components/agents/agent-connect-panel";
import { AgentConnectionPanel } from "@/components/agents/agent-connection-panel";
import { AgentProtectionStatus } from "@/components/agents/connection/agent-protection-status";
import type { ConnectionSnapshotJson } from "@/components/agents/connection/use-connection-status";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { BehaviorDetails, BehaviorSummary } from "@/components/behavior/behavior-view";
import { TrustDetails, TrustSummary } from "@/components/trust/trust-view";
import { RunGraphView, RunListView } from "@/components/graph/action-graph-view";
import { AgentControlPanel } from "@/components/control/agent-control-view";
export const metadata: Metadata = { title: "Agent" };

const CONNECTION_TONE: Record<string, PanelTone> = {
  CONNECTED: "safe",
  WAITING: "neutral",
  CREDENTIAL_VERIFIED: "neutral",
  NOT_SEEN_RECENTLY: "warning",
  ERROR: "warning",
  REVOKED: "blocked",
};

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; trace?: string; cursor?: string; rcursor?: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const { slug } = await params;
  const { tab: rawTab, trace, cursor, rcursor } = await searchParams;
  const tab = rawTab ?? "overview";

  const agent = await getAgentBySlug(organization.id, slug);
  if (!agent) notFound();

  const canManagePermissions = canManageAgentPermissions(role);
  const canManageThisAgent = canManageAgents(role);

  const activity =
    tab === "overview" || tab === "activity"
      ? await getAgentActivity(organization.id, agent.id, tab === "overview" ? 5 : 50)
      : [];

  const permissionSummary =
    tab === "overview" ? await getAgentPermissionSummary(organization.id, agent.id) : null;
  const permissions = tab === "permissions" ? await listAgentPermissions(organization.id, agent.id) : [];
  const agentPolicies = tab === "policies" ? await listPoliciesForAgent(organization.id, agent.id) : [];
  const agentApprovals = tab === "approvals" ? await listApprovalsForAgent(organization.id, agent.id, 20) : [];
  const agentSecurityAlerts = tab === "security" ? await listSecurityAlertsForAgent(organization.id, agent.id, 50) : [];

  // Behavioral memory (P2) is security data: same visibility as security alerts.
  const canViewBehavior = canViewSecurityAlerts(role);
  const [riskSecurityStats, riskActivityCounts, behavior, trustSummary] =
    tab === "overview"
      ? await Promise.all([
          getSecurityStatsForAgent(organization.id, agent.id),
          getAgentActivityStatusCounts(organization.id, agent.id),
          canViewBehavior ? getBehaviorProfile(organization.id, agent.id) : Promise.resolve(null),
          // Agent trust (P3) has the same visibility as behavior and security alerts.
          canViewBehavior ? getTrust(organization.id, agent.id) : Promise.resolve(null),
        ])
      : [null, null, null, null];
  const trustTab =
    tab === "trust" && canViewBehavior
      ? await Promise.all([getTrust(organization.id, agent.id), listTrustHistory(organization.id, agent.id, { limit: 20 })])
      : null;
  const behaviorTab =
    tab === "behavior" && canViewBehavior
      ? await Promise.all([
          getBehaviorProfile(organization.id, agent.id),
          listDeviations(organization.id, agent.id, { days: 14, limit: 50 }),
        ])
      : null;

  // Action graph (P6): decisions, policy, risk and approvals for the agent's activity — security-view visibility.
  const graphAllowed = canViewActionGraph(role);
  const graphTab =
    tab === "graph" && graphAllowed
      ? trace
        ? { run: await getRunGraph(organization.id, { id: agent.id, name: agent.name, slug: agent.slug }, trace, { cursor }), list: null }
        : { run: null, list: await listRuns(organization.id, agent.id, { cursor: rcursor }) }
      : null;

  // Control view (control plane): identity, access, behavior, trust, risk, approvals, enforcement coverage — security-view visibility.
  const controlView = tab === "control" && canViewBehavior ? await getAgentControlView(organization.id, slug) : null;

  const costPerSuccessfulTaskCents = tab === "costs" ? await getCostPerSuccessfulTaskForAgent(organization.id, agent.id) : null;

  // Connection, monitoring and decision state, derived from evidence (never from a stored click).
  const connectionSnapshot: ConnectionSnapshotJson | null = JSON.parse(JSON.stringify(await getAgentConnectionSnapshot(organization.id, agent.slug))) as ConnectionSnapshotJson | null;
  const latestScan = tab === "security" && canViewBehavior ? await getLatestAgentScan(organization.id, agent.id) : null;
  // Open alerts are a count of stored rows, shown only to viewers who may see security alerts.
  const openAlerts = canViewBehavior ? ((await getOpenAlertCounts(organization.id, [agent.id])).get(agent.id) ?? 0) : null;

  const connectionView =
    tab === "overview" && agent.connection
      ? {
          connectorType: agent.connection.connectorType,
          status: agent.connection.status,
          externalAccountLabel: agent.connection.externalAccountLabel,
          capabilities: agent.connection.capabilities as unknown as ConnectorCapabilities,
          connectedAtLabel: formatDateTime(agent.connection.connectedAt),
          lastVerifiedAtLabel: agent.connection.lastVerifiedAt ? formatRelativeTime(agent.connection.lastVerifiedAt) : null,
          lastHealthCheckAtLabel: agent.connection.lastHealthCheckAt
            ? formatRelativeTime(agent.connection.lastHealthCheckAt)
            : null,
          lastHealthError: agent.connection.lastHealthError,
        }
      : null;

  // The agent exists but has never reported activity — show a guided
  // "send your first event" panel instead of a bare empty state.
  const showConnectPanel = tab === "overview" && activity.length === 0;
  const [connectBaseUrl, activeApiKeyCount] = showConnectPanel
    ? await Promise.all([
        getCurrentOrigin(),
        prisma.apiKey.count({ where: { organizationId: organization.id, revokedAt: null } }),
      ])
    : ["", 0];

  return (
    <div>
      {(tab === "overview" || tab === "activity") && <LiveActivityRefresh />}
      <header className="mb-6">
        <Link href="/agents" className="focus-ring rounded-sm text-sm text-muted-foreground hover:text-foreground">
          Agents
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold text-foreground">{agent.name}</h1>
            {agent.description && <p className="mt-1 max-w-2xl text-muted-foreground">{agent.description}</p>}
          </div>
          {canManageThisAgent && (
            <div className="flex flex-wrap items-center gap-2">
              <AgentStatusToggle slug={agent.slug} status={agent.status} />
              <ButtonLink href={`/agents/${agent.slug}/edit`} variant="secondary" size="sm">
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </ButtonLink>
            </div>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{agent.environment.charAt(0) + agent.environment.slice(1).toLowerCase()}</span>
          {agent.status !== "ACTIVE" && <AgentStatusBadge status={agent.status} />}
        </p>

        <dl className="aegis-node mt-5 grid grid-cols-2 gap-x-6 gap-y-5 p-4 sm:p-5 lg:grid-cols-5">
          <div>
            <dt className="aegis-eyebrow">Connection</dt>
            <dd className="mt-1.5 text-sm font-medium">
              {connectionSnapshot ? (
                <StateLine tone={CONNECTION_TONE[connectionSnapshot.view.state]}>{connectionSnapshot.view.stateLabel}</StateLine>
              ) : (
                <span className="text-muted-foreground">Unknown</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="aegis-eyebrow">Last seen</dt>
            <dd className="mt-1.5 text-sm text-foreground">
              {connectionSnapshot?.view.lastSeenAt
                ? formatRelativeTime(new Date(connectionSnapshot.view.lastSeenAt))
                : agent.lastActiveAt
                  ? formatRelativeTime(agent.lastActiveAt)
                  : "Never seen"}
            </dd>
          </div>
          <div>
            <dt className="aegis-eyebrow">Monitoring</dt>
            <dd className="mt-1.5 text-sm text-foreground">{connectionSnapshot ? connectionSnapshot.view.monitoringLabel : "Unknown"}</dd>
          </div>
          <div>
            <dt className="aegis-eyebrow">Security alerts</dt>
            <dd className="mt-1.5 text-sm text-foreground">{openAlerts === null ? "Not visible to your role" : openAlerts > 0 ? `${openAlerts} open` : "None open"}</dd>
          </div>
          <div>
            <dt className="aegis-eyebrow">Policy</dt>
            <dd className="mt-1.5 text-sm text-foreground">
              {connectionSnapshot ? (connectionSnapshot.hasAllowRule ? "Allow rules in place" : "No allow rules · denied by default") : "Unknown"}
            </dd>
          </div>
        </dl>

        {openAlerts !== null && openAlerts > 0 && (
          <div role="note" className="mt-3 flex flex-col gap-3 rounded-xl border border-risk-border bg-risk-bg px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">
              <span className="font-semibold uppercase tracking-[0.12em] text-risk">Security alerts</span>
              <span className="ml-2 text-muted-foreground">
                {openAlerts} open {openAlerts === 1 ? "alert requires" : "alerts require"} attention.
              </span>
            </p>
            <ButtonLink href={`/agents/${agent.slug}?tab=security`} variant="secondary" size="sm">
              View security details
            </ButtonLink>
          </div>
        )}
      </header>

      <AgentTabs slug={agent.slug} active={tab} />

      {tab === "overview" && showConnectPanel && (
        <div className="mb-4">
          <AgentConnectPanel
            agentSlug={agent.slug}
            agentName={agent.name}
            baseUrl={connectBaseUrl}
            hasActiveApiKey={activeApiKeyCount > 0}
          />
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="self-start lg:col-span-2">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <Field label="Model provider" value={agent.modelProvider} />
                <Field label="Model" value={agent.modelName} />
                <Field label="Owner" value={agent.owner} />
                <Field
                  label="Environment"
                  value={agent.environment.charAt(0) + agent.environment.slice(1).toLowerCase()}
                />
                <Field label="Created" value={formatDateTime(agent.createdAt)} />
                <Field label="Spend this month" value={formatCurrency(agent.monthlySpendCents)} />
              </dl>

              <div className="mt-5 border-t border-border pt-5">
                <p className="mb-2 text-sm font-medium text-muted-foreground">
                  Tools
                </p>
                {agent.tools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tools registered.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.tools.map((tool) => (
                      <Badge key={tool.id} tone="neutral">
                        {tool.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {permissionSummary && (
                <div className="mt-5 border-t border-border pt-5">
                  <p className="mb-2 text-sm font-medium text-muted-foreground">
                    Permissions
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <Link href={`/agents/${agent.slug}?tab=permissions`} className="hover:underline">
                      <span className="font-medium text-success">{permissionSummary.ALLOW}</span>{" "}
                      <span className="text-muted-foreground">allow</span>
                    </Link>
                    <Link href={`/agents/${agent.slug}?tab=permissions`} className="hover:underline">
                      <span className="font-medium text-warning">
                        {permissionSummary.REQUIRE_APPROVAL}
                      </span>{" "}
                      <span className="text-muted-foreground">require approval</span>
                    </Link>
                    <Link href={`/agents/${agent.slug}?tab=permissions`} className="hover:underline">
                      <span className="font-medium text-danger">{permissionSummary.BLOCK}</span>{" "}
                      <span className="text-muted-foreground">block</span>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {connectionSnapshot && (
              <section aria-label="Connection status" className="space-y-3">
                <AgentProtectionStatus view={connectionSnapshot.view} />
                {connectionSnapshot.baseline === null || connectionSnapshot.baseline.maturity !== "ESTABLISHED" ? (
                  <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
                    <span className="section-label mr-2">{connectionSnapshot.baseline ? "Limited history" : "New agent"}</span>
                    Learning this agent&rsquo;s normal behavior. Events observed: <span className="num text-foreground">{connectionSnapshot.eventsObserved}</span>.
                    {connectionSnapshot.baseline ? " A baseline exists but is built from limited history." : " No baseline exists yet."}
                  </p>
                ) : (
                  <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
                    <span className="section-label mr-2">Baseline</span>
                    Established from <span className="num text-foreground">{connectionSnapshot.baseline.eventsObserved}</span> events (version {connectionSnapshot.baseline.version}).
                  </p>
                )}
              </section>
            )}
            {connectionView && (
              <AgentConnectionPanel
                agentSlug={agent.slug}
                connectorType={connectionView.connectorType}
                status={connectionView.status}
                externalAccountLabel={connectionView.externalAccountLabel}
                capabilities={connectionView.capabilities}
                connectedAtLabel={connectionView.connectedAtLabel}
                lastVerifiedAtLabel={connectionView.lastVerifiedAtLabel}
                lastHealthCheckAtLabel={connectionView.lastHealthCheckAtLabel}
                lastHealthError={connectionView.lastHealthError}
                canManage={canManageThisAgent}
                derived={
                  connectionSnapshot
                    ? {
                        state: connectionSnapshot.view.state,
                        stateLabel: connectionSnapshot.view.stateLabel,
                        detail: connectionSnapshot.view.detail,
                        reason: connectionSnapshot.view.reason,
                        lastSeenLabel: connectionSnapshot.view.lastSeenAt ? formatRelativeTime(new Date(connectionSnapshot.view.lastSeenAt)) : null,
                      }
                    : undefined
                }
              />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <Link
                  href={`/activity?agentId=${agent.id}`}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  View all
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                {activity.length === 0 ? (
                  <div className="px-5 py-8">
                    <EmptyState
                      icon={ActivityIcon}
                      title="No activity yet"
                      description="Actions from this agent will appear here."
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {activity.map((event) => (
                      <ActivityRow
                        key={event.id}
                        timestamp={event.timestamp}
                        action={event.action}
                        resource={event.resource}
                        status={event.status}
                        source={event.source}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {behavior && (
              <Card>
                <CardHeader>
                  <CardTitle>Behavior</CardTitle>
                </CardHeader>
                <CardContent>
                  <BehaviorSummary
                    slug={agent.slug}
                    meta={behavior.baseline}
                    deviationCount={behavior.recentDeviations.length}
                  />
                </CardContent>
              </Card>
            )}

            {trustSummary && (
              <Card>
                <CardHeader>
                  <CardTitle>Trust</CardTitle>
                </CardHeader>
                <CardContent>
                  <TrustSummary slug={agent.slug} trust={trustSummary} />
                </CardContent>
              </Card>
            )}

            {riskSecurityStats && riskActivityCounts && (
              <Card>
                <CardHeader>
                  <CardTitle>Agent health</CardTitle>
                  <Link href="/security" className="text-xs font-medium text-muted-foreground hover:text-foreground">
                    Security
                  </Link>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Activity</span>
                    <span className={`font-medium ${riskSecurityStats.hasActivityAnomaly ? "text-warning" : "text-success"}`}>
                      {riskSecurityStats.hasActivityAnomaly ? "Unusual" : "Normal"}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Actions (24h)</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-foreground">{riskActivityCounts.total}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">High-risk actions (24h)</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${riskActivityCounts.highRisk > 0 ? "text-danger" : "text-foreground"}`}>
                        {riskActivityCounts.highRisk}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Block decisions (24h)</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${riskActivityCounts.blocked > 0 ? "text-danger" : "text-foreground"}`}>
                        {riskActivityCounts.blocked}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Warnings (24h)</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${riskActivityCounts.warnings > 0 ? "text-warning" : "text-foreground"}`}>
                        {riskActivityCounts.warnings}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Approval required (24h)</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-foreground">{riskActivityCounts.approvalRequired}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Open security alerts</dt>
                      <dd className={`mt-0.5 font-medium tabular-nums ${riskSecurityStats.open > 0 ? "text-warning" : "text-foreground"}`}>
                        {riskSecurityStats.open}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 border-t border-border pt-4 text-sm">
                    <span className="text-muted-foreground">Cost anomaly: </span>
                    <span className={riskSecurityStats.hasCostAnomaly ? "font-medium text-warning" : "text-foreground"}>
                      {riskSecurityStats.hasCostAnomaly ? "Active" : "None"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "activity" && (
        <Card>
          <CardContent className="p-0">
            {activity.length === 0 ? (
              <div className="px-5 py-12">
                <EmptyState
                  icon={ActivityIcon}
                  title="No activity yet"
                  description="Actions from this agent will appear here as they happen."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activity.map((event) => (
                  <ActivityRow
                    key={event.id}
                    timestamp={event.timestamp}
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
          </CardContent>
        </Card>
      )}

      {tab === "tools" && (
        <Card>
          <CardContent className="p-0">
            {agent.tools.length === 0 ? (
              <div className="px-5 py-12">
                <EmptyState
                  icon={Wrench}
                  title="No tools registered"
                  description="Tools this agent can call will appear here once connected via the Aegis SDK."
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {agent.tools.map((tool) => (
                  <li key={tool.id} className="flex items-center justify-between px-5 py-3.5">
                    <span className="text-sm font-medium text-foreground">{tool.name}</span>
                    <Badge tone="neutral">{tool.category}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "permissions" && (
        <div>
          {canManagePermissions && (
            <div className="mb-4 flex justify-end">
              <ButtonLink href={`/agents/${agent.slug}/permissions/new`} size="sm">
                <Plus className="size-3.5" aria-hidden="true" />
                Add permission
              </ButtonLink>
            </div>
          )}
          {permissions.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No permissions configured"
              description="Unconfigured actions are blocked by default. Add a permission to explicitly allow, require approval, or block a specific action for this agent."
              action={
                canManagePermissions && (
                  <ButtonLink href={`/agents/${agent.slug}/permissions/new`} size="sm">
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add permission
                  </ButtonLink>
                )
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <PermissionsTable
                permissions={permissions}
                agentSlug={agent.slug}
                canManage={canManagePermissions}
              />
            </div>
          )}
        </div>
      )}

      {tab === "costs" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Spend this month
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {formatCurrency(agent.monthlySpendCents)}
                  </p>
                </div>
                <DollarSign className="size-8 text-muted-foreground/40" aria-hidden="true" />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm font-medium text-muted-foreground">
                  Cost per successful task
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {costPerSuccessfulTaskCents === null ? "Not enough data" : formatCurrency(costPerSuccessfulTaskCents)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {costPerSuccessfulTaskCents === null
                    ? "Requires taskId on ingested events — see the SDK's track() taskId field."
                    : "This month, averaged across tasks with at least one successful step."}
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm text-muted-foreground">Full per-agent, per-provider, and per-model breakdowns live on the org-wide Costs page.</p>
              <ButtonLink href="/costs" variant="secondary" size="sm">
                Open Costs
              </ButtonLink>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "approvals" && (
        <div>
          {agentApprovals.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No approval requests for this agent"
              description="Actions from this agent that required human sign-off will appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <ul className="divide-y divide-border">
                {agentApprovals.map((request) => {
                  const lastDecision = request.decisions[0];
                  return (
                    <li key={request.id} className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm">
                      <div className="min-w-0">
                        <Link
                          href={`/approvals/${request.id}`}
                          className="truncate font-mono text-xs text-foreground hover:underline"
                        >
                          {request.action}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {formatRelativeTime(request.requestedAt)}
                          {lastDecision &&
                            ` · ${lastDecision.decision === "APPROVED" ? "Approved" : "Rejected"} by ${
                              lastDecision.decidedBy.name ?? lastDecision.decidedBy.email
                            }`}
                        </p>
                      </div>
                      <ApprovalStatusBadge status={request.status} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "policies" && (
        <div>
          {agentPolicies.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No policies apply to this agent"
              description="Policies scoped to this agent, or to any agent, will appear here."
              action={
                <ButtonLink href="/policies/new" size="sm">
                  <Plus className="size-3.5" aria-hidden="true" />
                  Create policy
                </ButtonLink>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <AgentPoliciesList policies={agentPolicies} agentName={agent.name} />
            </div>
          )}
        </div>
      )}

      {tab === "behavior" &&
        (behaviorTab && behaviorTab[0] ? (
          <BehaviorDetails meta={behaviorTab[0].baseline} profile={behaviorTab[0].profile} deviations={behaviorTab[1] ?? []} />
        ) : (
          <EmptyState
            icon={ShieldAlert}
            title="Behavior isn't available to your role"
            description="Behavioral data has the same visibility as security alerts."
          />
        ))}

      {tab === "control" &&
        (!canViewBehavior ? (
          <EmptyState icon={ShieldAlert} title="The control view isn't available to your role" description="It shows access, trust, risk and enforcement, so it has the same visibility as security alerts." />
        ) : controlView ? (
          <AgentControlPanel view={controlView} organizationName={organization.name} />
        ) : (
          <EmptyState icon={ShieldAlert} title="Agent not found" description="This agent is not in your organization." />
        ))}

      {tab === "graph" &&
        (!graphAllowed ? (
          <EmptyState
            icon={ShieldAlert}
            title="The action graph isn't available to your role"
            description="The action graph shows decisions, policies and risk, so it has the same visibility as security alerts."
          />
        ) : graphTab?.run ? (
          <RunGraphView slug={agent.slug} run={graphTab.run} />
        ) : graphTab?.list ? (
          <RunListView slug={agent.slug} list={graphTab.list} />
        ) : (
          <EmptyState icon={ShieldAlert} title="Run not found" description="No run with that trace id exists for this agent." />
        ))}

      {tab === "trust" &&
        (trustTab && trustTab[0] ? (
          <TrustDetails trust={trustTab[0]} transitions={trustTab[1]?.transitions ?? []} />
        ) : (
          <EmptyState
            icon={ShieldAlert}
            title="Trust isn't available to your role"
            description="Trust data has the same visibility as security alerts."
          />
        ))}

      {tab === "security" && (
        <div>
          {canViewBehavior && (
            <AgentScanPanel
              slug={agent.slug}
              canScan={canManageAgents(role)}
              blockedReason={(() => {
                const e = scanEligibility({ state: connectionSnapshot?.view.state ?? "WAITING", connectorType: connectionSnapshot?.connectorType ?? null, firstHandshakeAt: connectionSnapshot?.view.firstHandshakeAt ?? null });
                return e.ok ? null : e.message;
              })()}
              scan={latestScan ? { createdAtIso: latestScan.createdAt.toISOString(), result: latestScan.result } : null}
            />
          )}
          <div className="mb-4 flex justify-end">
            <ButtonLink href={`/audit?agentId=${agent.id}`} variant="secondary" size="sm">
              View audit trail
            </ButtonLink>
          </div>
          {agentSecurityAlerts.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No security alerts for this agent"
              description="Detected anomalies, policy violations, and risk indicators for this agent will appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <ul className="divide-y divide-border">
                {agentSecurityAlerts.map((alert) => (
                  <li key={alert.id} className="px-5 py-3.5">
                    <Link
                      href={`/security/${alert.id}`}
                      className="focus-ring flex items-center justify-between gap-3 rounded-sm text-sm hover:underline"
                    >
                      <span className="min-w-0 truncate font-medium text-foreground">{alert.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <SecurityAlertSeverityBadge severity={alert.severity} />
                        <SecurityAlertStatusBadge status={alert.status} />
                      </span>
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatRelativeTime(alert.lastSeenAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
