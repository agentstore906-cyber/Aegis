import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManagePolicies } from "@/lib/policies/authorization";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { createPolicyAction } from "@/lib/policies/actions";
import type { Policy, PolicyDecision, RiskLevel } from "@prisma/client";

import { PageHeader } from "@/components/dashboard/page-header";
import { PolicyForm } from "@/components/policies/policy-form";

export const metadata: Metadata = { title: "Create policy" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Supports prefilling from a Security Alert's "Create policy from alert" link — never auto-creates, just pre-fills the form. */
export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) notFound();

  const agents = await listAllAgentsForOrg(organization.id);
  const raw = await searchParams;

  const prefill: Partial<Policy> | undefined =
    typeof raw.action === "string"
      ? {
          name: typeof raw.name === "string" ? raw.name : undefined,
          action: raw.action,
          agentId: typeof raw.agentId === "string" ? raw.agentId : null,
          decision: typeof raw.decision === "string" ? (raw.decision as PolicyDecision) : "REQUIRE_APPROVAL",
          riskLevel: typeof raw.riskLevel === "string" ? (raw.riskLevel as RiskLevel) : null,
        }
      : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create policy" description="Turn a company rule into an agent guardrail." />
      <PolicyForm agents={agents} action={createPolicyAction} policy={prefill} />
    </div>
  );
}
