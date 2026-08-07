import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentBySlug } from "@/lib/agents/queries";
import { canManageAgentPermissions } from "@/lib/policies/authorization";
import { createAgentPermissionAction } from "@/lib/policies/actions";

import { PageHeader } from "@/components/dashboard/page-header";
import { PermissionForm } from "@/components/policies/permission-form";

export const metadata: Metadata = { title: "Add permission" };

export default async function NewPermissionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const { slug } = await params;

  if (!canManageAgentPermissions(role)) notFound();

  const agent = await getAgentBySlug(organization.id, slug);
  if (!agent) notFound();

  const boundAction = createAgentPermissionAction.bind(null, slug);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={`Add permission — ${agent.name}`}
        description="Set the baseline decision for one action this agent can request."
      />
      <div className="rounded-lg border border-border bg-surface p-6">
        <PermissionForm agentSlug={slug} action={boundAction} />
      </div>
    </div>
  );
}
