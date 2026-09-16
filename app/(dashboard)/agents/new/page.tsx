import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { trackEvent } from "@/lib/analytics/track";
import { prisma } from "@/lib/db";
import { getPlan } from "@/lib/billing/plans";

import { PageHeader } from "@/components/dashboard/page-header";
import { ConnectAgentWizard } from "@/components/agents/connect-agent-wizard";
import { UsageBar } from "@/components/billing/usage-bar";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Connect agent" };

export default async function NewAgentPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) notFound();

  trackEvent("agent_connection_started", { organizationId: organization.id });

  const agentCount = await prisma.agent.count({ where: { organizationId: organization.id } });
  const plan = getPlan(organization.plan);
  const atLimit = plan.agentLimit !== null && agentCount >= plan.agentLimit;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Connect agent"
        description="Connect an agent you already run — Aegis verifies the connection and starts monitoring automatically."
      />
      {plan.agentLimit !== null && (
        <div className="mb-4">
          {atLimit ? (
            <Alert tone="warning">
              You&rsquo;ve used all {plan.agentLimit} agents on the {plan.name} plan.{" "}
              <a href="/upgrade" className="underline">
                Upgrade
              </a>{" "}
              for more.
            </Alert>
          ) : (
            <UsageBar label="Agents" used={agentCount} limit={plan.agentLimit} />
          )}
        </div>
      )}
      <ConnectAgentWizard atLimit={atLimit} />
    </div>
  );
}
