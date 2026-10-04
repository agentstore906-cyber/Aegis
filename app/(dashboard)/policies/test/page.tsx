import type { Metadata } from "next";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { canManagePolicies } from "@/lib/policies/authorization";

import { PageHeader } from "@/components/dashboard/page-header";
import { PolicyTesterForm } from "@/components/policies/policy-tester-form";

export const metadata: Metadata = { title: "Policy tester" };

export default async function PolicyTesterPage() {
  const { organization, role } = await requireActiveOrganization();
  const agents = await listAllAgentsForOrg(organization.id);

  return (
    <div>
      <PageHeader
        title="Policy tester"
        description="Ask what Aegis would do for an action, before it happens. Simulation runs the same decision stages as the real engine and records nothing."
      />
      <PolicyTesterForm agents={agents} canRecord={canManagePolicies(role)} />
    </div>
  );
}
