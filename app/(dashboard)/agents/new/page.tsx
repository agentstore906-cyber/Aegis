import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { listTeams } from "@/lib/teams/repository";
import { trackEvent } from "@/lib/analytics/track";
import { prisma } from "@/lib/db";
import { getPlan } from "@/lib/billing/plans";

import { PageHeader } from "@/components/dashboard/page-header";
import { CreateAgentForm } from "@/components/agents/create-agent-form";
import { UsageBar } from "@/components/billing/usage-bar";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Create agent" };

export default async function NewAgentPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) notFound();

  trackEvent("agent_connection_started", { organizationId: organization.id });

  const [teams, agentCount] = await Promise.all([
    listTeams(organization.id),
    prisma.agent.count({ where: { organizationId: organization.id } }),
  ]);
  const plan = getPlan(organization.plan);
  const atLimit = plan.agentLimit !== null && agentCount >= plan.agentLimit;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Create agent"
        description="Register a new agent so Aegis can start tracking its activity."
      />
      {plan.agentLimit !== null && (
        <div className="mb-4">
          {atLimit ? (
            <Alert tone="warning">
              You&rsquo;ve used all {plan.agentLimit} agents on the {plan.name} plan.{" "}
              <a href="/settings/billing" className="underline">
                Upgrade
              </a>{" "}
              for more.
            </Alert>
          ) : (
            <UsageBar label="Agents" used={agentCount} limit={plan.agentLimit} />
          )}
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface p-6">
        <CreateAgentForm teams={teams} />
      </div>
    </div>
  );
}
