import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentBySlug } from "@/lib/agents/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { EditAgentForm } from "@/components/agents/edit-agent-form";

export const metadata: Metadata = { title: "Edit agent" };

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { organization } = await requireActiveOrganization();
  const { slug } = await params;
  const agent = await getAgentBySlug(organization.id, slug);

  if (!agent) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Edit ${agent.name}`} description="Update this agent's details." />
      <div className="rounded-lg border border-border bg-surface p-6">
        <EditAgentForm agent={agent} />
      </div>
    </div>
  );
}
