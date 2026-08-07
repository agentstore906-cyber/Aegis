import type { Metadata } from "next";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAllAgentsForOrg } from "@/lib/agents/queries";

import { PageHeader } from "@/components/dashboard/page-header";
import { PolicyTesterForm } from "@/components/policies/policy-tester-form";

export const metadata: Metadata = { title: "Policy tester" };

export default async function PolicyTesterPage() {
  const { organization } = await requireActiveOrganization();
  const agents = await listAllAgentsForOrg(organization.id);

  return (
    <div>
      <PageHeader
        title="Policy tester"
        description="Test an action before connecting it to production. Evaluations run through the real policy engine and are recorded in history."
      />
      <PolicyTesterForm agents={agents} />
    </div>
  );
}
