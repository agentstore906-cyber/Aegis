import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { listTeams } from "@/lib/teams/repository";
import { trackEvent } from "@/lib/analytics/track";

import { PageHeader } from "@/components/dashboard/page-header";
import { CreateAgentForm } from "@/components/agents/create-agent-form";

export const metadata: Metadata = { title: "Create agent" };

export default async function NewAgentPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) notFound();

  trackEvent("agent_connection_started", { organizationId: organization.id });

  const teams = await listTeams(organization.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Create agent"
        description="Register a new agent so Aegis can start tracking its activity."
      />
      <div className="rounded-lg border border-border bg-surface p-6">
        <CreateAgentForm teams={teams} />
      </div>
    </div>
  );
}
