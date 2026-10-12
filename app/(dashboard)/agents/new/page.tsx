import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { trackEvent } from "@/lib/analytics/track";
import { prisma } from "@/lib/db";
import { getPlan } from "@/lib/billing/plans";
import { canAccessUpgradePage } from "@/lib/billing/authorization";
import { countAgentsTowardLimit, countRetiredAgents } from "@/lib/agents/quota";

import { PageHeader } from "@/components/dashboard/page-header";
import { AgentConnectionWizard } from "@/components/agents/agent-connection-wizard";
import { ConnectAgentWizard } from "@/components/agents/connect-agent-wizard";
import { UsageBar } from "@/components/billing/usage-bar";
import { UpgradeLink } from "@/components/billing/upgrade-link";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Connect agent" };

export default async function NewAgentPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) notFound();

  trackEvent("agent_connection_started", { organizationId: organization.id });

  const [agentCount, retiredCount] = await Promise.all([countAgentsTowardLimit(prisma, organization.id), countRetiredAgents(prisma, organization.id)]);
  const plan = getPlan(organization.plan);
  const atLimit = plan.agentLimit !== null && agentCount >= plan.agentLimit;
  // /upgrade is a billing page (OWNER / ADMIN / FINANCE). Never link a role that would land on a 404; tell them who can upgrade instead.
  const canUpgrade = canAccessUpgradePage(role);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Connect your AI agent" description="Give Aegis your agent's endpoint. Aegis connects to it and verifies it." />
      {plan.agentLimit !== null && (
        <div className="mb-4">
          {atLimit ? (
            <Alert tone="warning">
              You&rsquo;ve used all {plan.agentLimit} agents on the {plan.name} plan.{" "}
              <UpgradeLink canUpgrade={canUpgrade} />
            </Alert>
          ) : (
            <UsageBar label="Agents" used={agentCount} limit={plan.agentLimit} />
          )}
          {retiredCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {retiredCount} retired {retiredCount === 1 ? "agent still counts" : "agents still count"} toward this limit.
            </p>
          )}
        </div>
      )}
      <AgentConnectionWizard atLimit={atLimit} />

      {!atLimit && (
        <details className="group mt-6 rounded-lg border border-border bg-surface">
          <summary className="focus-ring cursor-pointer list-none rounded-lg px-5 py-3.5 text-sm font-medium text-foreground">
            Advanced connection options
            <span className="ml-2 text-xs font-normal text-muted-foreground">Connect with an OpenAI or Anthropic API key</span>
          </summary>
          <div className="border-t border-border p-4">
            <ConnectAgentWizard atLimit={false} />
          </div>
        </details>
      )}
    </div>
  );
}
