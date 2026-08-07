import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAgentBySlug } from "@/lib/agents/queries";
import { canManageAgentPermissions } from "@/lib/policies/authorization";
import { updateAgentPermissionAction } from "@/lib/policies/actions";
import { getAgentPermission } from "@/lib/policies/repository";

import { PageHeader } from "@/components/dashboard/page-header";
import { PermissionForm } from "@/components/policies/permission-form";

export const metadata: Metadata = { title: "Edit permission" };

export default async function EditPermissionPage({
  params,
}: {
  params: Promise<{ slug: string; permissionId: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const { slug, permissionId } = await params;

  if (!canManageAgentPermissions(role)) notFound();

  const agent = await getAgentBySlug(organization.id, slug);
  if (!agent) notFound();

  const permission = await getAgentPermission(organization.id, permissionId);
  if (!permission || permission.agentId !== agent.id) notFound();

  const boundAction = updateAgentPermissionAction.bind(null, slug, permissionId);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={`Edit permission — ${agent.name}`}
        description="Update the baseline decision for this action."
      />
      <div className="rounded-lg border border-border bg-surface p-6">
        <PermissionForm agentSlug={slug} permission={permission} action={boundAction} />
      </div>
    </div>
  );
}
