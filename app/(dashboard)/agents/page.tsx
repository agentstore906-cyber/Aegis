import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus, PlugZap, ScanSearch, ShieldAlert, Sparkles } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAgents, listLiveAgentIds } from "@/lib/agents/queries";
import { getAgentListSignals, getOpenAlertCounts } from "@/lib/agents/list-signals";
import { canManageAgents } from "@/lib/agents/authorization";
import { getApprovalStats } from "@/lib/approvals/repository";
import { canViewBilling } from "@/lib/billing/authorization";
import { searchIncidents } from "@/lib/incidents/service";
import { countOpenAlerts, getSecurityActivity } from "@/lib/overview/security-activity";
import { listScanTargets } from "@/lib/scanner/agent-scan-targets";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { agentFiltersSchema } from "@/lib/validation/agent";

import { AegisCore, type CoreNode } from "@/components/console/aegis-core";
import { AgentNode, CONNECTION_STATUS } from "@/components/console/agent-node";
import { ActivityFeed, EmptyAgents, QuickActions, StatusRail, UpgradeCta, type Figure, type QuickAction } from "@/components/console/control-overview";
import { AgentFilters } from "@/components/agents/agent-filters";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Aegis Control" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Aegis Control — the home overview. Every agent shown is a database row of this organization; every status on it is
 * derived from stored evidence (connection, monitoring); every figure is a count of stored rows; every activity item
 * is a stored event. There is no sample data and no score: with no agents the page says so and offers the next step.
 */
export default async function AegisControlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization, role, user } = await requireActiveOrganization();
  const raw = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  // A hand-edited or stale URL (?page=0, ?status=bogus) must never crash the page: invalid input falls back to the default view.
  const parsedFilters = agentFiltersSchema.safeParse({ q: str(raw.q), status: str(raw.status), page: str(raw.page) });
  const filters = parsedFilters.success ? parsedFilters.data : agentFiltersSchema.parse({});
  const hasFilters = Boolean(filters.q || filters.status);
  const canManage = canManageAgents(role);
  const canSecurity = canViewSecurityAlerts(role);
  // Same audience as the Upgrade link in the top bar; there is nothing to upgrade to on the top plan.
  const showUpgrade = canViewBilling(role) && organization.plan !== "enterprise";

  // The grid is one page of the (filtered) agents. The organization-wide figures and the core read ALL live agents,
  // so a second page never changes what the headline numbers say.
  const [{ agents: live, total, pageCount }, everyone] = await Promise.all([listAgents(organization.id, filters, { excludeArchived: true }), listLiveAgentIds(organization.id)]);
  const ids = live.map((a) => a.id);
  const orgTotal = everyone.truncated ? null : everyone.ids.length;
  const hasAgents = everyone.ids.length > 0;

  const [signals, orgSignals, alertCounts, approvals, incidents, openAlerts, activity, scan] = await Promise.all([
    getAgentListSignals(organization.id, ids),
    orgTotal === null ? Promise.resolve(null) : getAgentListSignals(organization.id, everyone.ids),
    canSecurity ? getOpenAlertCounts(organization.id, ids) : Promise.resolve(null),
    hasAgents ? getApprovalStats(organization.id) : Promise.resolve(null),
    hasAgents && canSecurity ? searchIncidents({ organizationId: organization.id, userId: user.id, role }, { status: ["OPEN", "INVESTIGATING"], pageSize: 1 }) : Promise.resolve(null),
    hasAgents && canSecurity ? countOpenAlerts(organization.id) : Promise.resolve(null),
    getSecurityActivity({ organizationId: organization.id, canViewSecurity: canSecurity }),
    canSecurity && hasAgents ? listScanTargets(organization.id) : Promise.resolve(null),
  ]);

  const nodes = live.flatMap((a) => {
    const c = signals.get(a.id)?.connection;
    return c ? [{ agent: a, c }] : [];
  });
  const coreNodes: CoreNode[] = nodes.map(({ agent, c }) => ({
    id: agent.id,
    name: agent.name,
    tone: CONNECTION_STATUS[c.state].tone,
    connected: c.state === "CONNECTED",
    receiving: c.state === "CONNECTED" && c.monitoring === "RECEIVING",
  }));
  // Counted from the evidence-derived state of every live agent; unavailable (null) beyond the cap, never estimated.
  const orgStates = orgSignals ? [...orgSignals.values()].map((s) => s.connection) : null;
  const connectedCount = orgStates ? orgStates.filter((c) => c.state === "CONNECTED").length : null;
  const receivingCount = orgStates ? orgStates.filter((c) => c.state === "CONNECTED" && c.monitoring === "RECEIVING").length : null;
  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    params.set("page", String(page));
    return `/agents?${params.toString()}`;
  };
  // A page past the end (agents were removed, or the URL was edited) goes to the last real page, not an empty one.
  if (filters.page > pageCount && total > 0) redirect(buildHref(pageCount));
  const waiting = approvals?.pending ?? 0;
  const openIncidents = incidents?.total ?? 0;

  const figures: Figure[] = [
    { label: "Agents", value: orgTotal ?? total },
    { label: "Connected", value: connectedCount },
    { label: "Sending activity", value: receivingCount },
    ...(canSecurity ? [{ label: "Open alerts", value: openAlerts, href: "/security", attention: true }, { label: "Open incidents", value: openIncidents, href: "/incidents", attention: true }] : []),
    { label: "Awaiting approval", value: waiting, href: "/approvals", attention: true },
  ];

  const canScanNow = (scan?.targets.length ?? 0) > 0;
  const actions: QuickAction[] = [
    ...(canManage ? [{ key: "connect", href: "/agents/new", title: "Connect Agent", description: "Bring a real agent into Aegis.", icon: PlugZap }] : []),
    ...(canSecurity
      ? [
          canScanNow
            ? { key: "scan", href: "/risk-scan", title: "Scan Agent", description: "Scan a connected agent in the Free Risk Scanner.", icon: ScanSearch }
            : { key: "scan", href: "/risk-scan", title: "Free Risk Scanner", description: "Connect an agent to start scanning.", icon: ScanSearch },
          { key: "security", href: "/security", title: "View Security", description: "Alerts, incidents and decisions.", icon: ShieldAlert },
        ]
      : []),
    ...(showUpgrade ? [{ key: "upgrade", href: "/upgrade", title: "Upgrade", description: "Unlock advanced agent controls.", icon: Sparkles }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      {/* Title bar: the page's name, and the Upgrade call to action. */}
      <div className="aegis-rise flex flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Aegis Control</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Your security command layer for AI agents.</p>
        </div>
        {showUpgrade && <UpgradeCta className="w-full sm:w-auto sm:min-w-72" />}
      </div>

      {/* Hero: what Aegis is for, and the live picture of the connected agents. */}
      <section aria-labelledby="hero-heading" className="aegis-hero aegis-rise mt-5 px-5 py-8 sm:px-10 sm:py-12 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-8">
        <div className="min-w-0">
          <p className="aegis-eyebrow text-accent">AI agent security</p>
          <h2 id="hero-heading" className="mt-3 text-3xl font-semibold leading-[1.1] tracking-tight text-balance text-foreground sm:text-5xl">
            Control every agent with confidence.
          </h2>
          <p className="mt-4 max-w-md text-pretty text-base text-muted-foreground">Connect your AI agents, monitor their security posture, and enforce control from one place.</p>
          {hasAgents && (
            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              {canManage ? (
                <ButtonLink href="/agents/new" size="lg">
                  <Plus className="size-4" aria-hidden="true" />
                  Connect Agent
                </ButtonLink>
              ) : (
                <p className="text-sm text-muted-foreground">Ask an owner or admin to connect an agent.</p>
              )}
              {canSecurity && (
                <ButtonLink href="/risk-scan" size="lg" variant="secondary">
                  <ScanSearch className="size-4" aria-hidden="true" />
                  {canScanNow ? "Scan Agent" : "Free Risk Scanner"}
                </ButtonLink>
              )}
            </div>
          )}
        </div>
        <div className="mt-8 min-w-0 lg:mt-0">
          <AegisCore nodes={coreNodes} total={orgTotal ?? coreNodes.length} summary={connectedCount !== null && receivingCount !== null ? { connected: connectedCount, receiving: receivingCount } : null} />
        </div>
      </section>

      {!hasAgents ? (
        <div className="mt-6">
          <EmptyAgents canManage={canManage} canScan={canSecurity} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatusRail figures={figures} />
          </div>

          <section aria-labelledby="agents-heading" className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-3 px-1">
              <h2 id="agents-heading" className="text-lg font-semibold tracking-tight text-foreground">
                Your Agents
              </h2>
              {canManage && (
                <ButtonLink href="/agents/new" variant="secondary" size="sm">
                  <Plus className="size-4" aria-hidden="true" />
                  Connect another agent
                </ButtonLink>
              )}
            </div>
            {(hasFilters || (orgTotal ?? total) > 8) && (
              <div className="mb-4">
                <AgentFilters />
              </div>
            )}
            {nodes.length === 0 && <p className="rounded-xl border border-border bg-surface/60 px-4 py-8 text-center text-sm text-muted-foreground">No agents match these filters.</p>}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nodes.map(({ agent, c }, i) => (
                <AgentNode
                  key={agent.id}
                  index={i}
                  agent={{
                    slug: agent.slug,
                    name: agent.name,
                    status: agent.status,
                    connection: { state: c.state, monitoring: c.monitoring, lastSeenAt: c.lastSeenAt },
                    lastActivityAt: agent.lastActiveAt,
                    openAlerts: alertCounts ? (alertCounts.get(agent.id) ?? 0) : undefined,
                  }}
                />
              ))}
            </ul>
            <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
          </section>
        </>
      )}

      {/* What happened, and what to do next. */}
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ActivityFeed items={activity} />
        {actions.length > 0 && <QuickActions actions={actions} />}
      </div>
    </div>
  );
}
