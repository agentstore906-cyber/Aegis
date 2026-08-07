import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManagePolicies } from "@/lib/policies/authorization";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { getPolicy } from "@/lib/policies/repository";
import { updatePolicyAction } from "@/lib/policies/actions";

import { PageHeader } from "@/components/dashboard/page-header";
import { PolicyForm } from "@/components/policies/policy-form";

export const metadata: Metadata = { title: "Edit policy" };

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) notFound();

  const { id } = await params;
  const [policy, agents] = await Promise.all([
    getPolicy(organization.id, id),
    listAllAgentsForOrg(organization.id),
  ]);

  if (!policy) notFound();

  const boundAction = updatePolicyAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Edit ${policy.name}`} description="Update this policy's scope and conditions." />
      <PolicyForm policy={policy} conditions={policy.conditions} agents={agents} action={boundAction} />
    </div>
  );
}
