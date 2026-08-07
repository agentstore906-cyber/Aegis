import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManagePolicies } from "@/lib/policies/authorization";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { createPolicyAction } from "@/lib/policies/actions";

import { PageHeader } from "@/components/dashboard/page-header";
import { PolicyForm } from "@/components/policies/policy-form";

export const metadata: Metadata = { title: "Create policy" };

export default async function NewPolicyPage() {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) notFound();

  const agents = await listAllAgentsForOrg(organization.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create policy" description="Turn a company rule into an agent guardrail." />
      <PolicyForm agents={agents} action={createPolicyAction} />
    </div>
  );
}
