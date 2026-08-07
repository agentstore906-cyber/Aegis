import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Wrench, ShieldCheck, DollarSign, Activity as ActivityIcon } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getAgentActivity } from "@/lib/activity/queries";
import { formatCurrency, formatDateTime, formatRelativeTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { AgentTabs } from "@/components/agents/agent-tabs";
import { AgentStatusToggle } from "@/components/agents/agent-status-toggle";
import { AgentStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { ActivityRow } from "@/components/activity/activity-row";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PhasePreview } from "@/components/dashboard/phase-preview";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { organization } = await requireActiveOrganization();
  const { slug } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = rawTab ?? "overview";

  const agent = await getAgentBySlug(organization.id, slug);
  if (!agent) notFound();

  const activity =
    tab === "overview" || tab === "activity"
      ? await getAgentActivity(organization.id, agent.id, tab === "overview" ? 5 : 50)
      : [];

  return (
    <div>
      <PageHeader
        title={agent.name}
        description={agent.description ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <AgentStatusToggle slug={agent.slug} status={agent.status} />
            <ButtonLink href={`/agents/${agent.slug}/edit`} variant="secondary" size="sm">
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </ButtonLink>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <AgentStatusBadge status={agent.status} />
        <RiskBadge level={agent.riskLevel} />
        <Badge tone="neutral">{agent.owner}</Badge>
        <Badge tone="neutral">{agent.environment.charAt(0) + agent.environment.slice(1).toLowerCase()}</Badge>
        <span className="text-xs text-muted-foreground">
          Last active{" "}
          {agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "never"}
        </span>
      </div>

      <AgentTabs slug={agent.slug} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
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
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            </CardContent>
          </Card>

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
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
                    status={event.status}
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
        <PhasePreview
          icon={ShieldCheck}
          title="Agent permissions"
          description="Define exactly which resources and actions this agent can access. Coming with the Aegis policy engine."
          phase="Phase 2 — Policy Engine"
        />
      )}

      {tab === "costs" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Spend this month
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {formatCurrency(agent.monthlySpendCents)}
                </p>
              </div>
              <DollarSign className="size-8 text-muted-foreground/40" aria-hidden="true" />
            </CardContent>
          </Card>
          <PhasePreview
            icon={DollarSign}
            title="Cost breakdowns"
            description="Per-model, per-task, and anomaly-aware cost analytics are coming in a future phase."
            phase="Phase 5 — Cost Intelligence"
          />
        </div>
      )}

      {tab === "policies" && (
        <PhasePreview
          icon={ShieldCheck}
          title="Policies"
          description="Guardrails that automatically allow, block, or require approval for this agent's actions."
          phase="Phase 2 — Policy Engine"
        />
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
