import type { Metadata } from "next";
import { History } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listPolicyEvaluations } from "@/lib/policies/repository";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { evaluationFiltersSchema } from "@/lib/validation/policy";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EvaluationFilters } from "@/components/policies/evaluation-filters";
import { EvaluationsTable } from "@/components/policies/evaluations-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Policy evaluations" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = evaluationFiltersSchema.parse({
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    decision: typeof raw.decision === "string" ? raw.decision : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [{ evaluations, total, pageCount }, agents] = await Promise.all([
    listPolicyEvaluations(organization.id, filters),
    listAllAgentsForOrg(organization.id),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.decision) params.set("decision", filters.decision);
    params.set("page", String(page));
    return `/policies/evaluations?${params.toString()}`;
  };

  const hasFilters = Boolean(filters.agentId || filters.decision);

  return (
    <div>
      <PageHeader
        title="Evaluation history"
        description={`${total} evaluation${total === 1 ? "" : "s"} — see why Aegis allowed, blocked, or escalated every action.`}
        action={
          <ButtonLink href="/policies" variant="secondary" size="sm">
            Back to policies
          </ButtonLink>
        }
      />

      <div className="mb-4">
        <EvaluationFilters agents={agents} />
      </div>

      {evaluations.length === 0 ? (
        <EmptyState
          icon={History}
          title={hasFilters ? "No evaluations match your filters" : "No policy evaluations yet"}
          description={
            hasFilters
              ? "Try adjusting your filters."
              : "Use the policy tester to evaluate your first action."
          }
          action={
            !hasFilters && (
              <ButtonLink href="/policies/test" size="sm">
                Test policy
              </ButtonLink>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <EvaluationsTable evaluations={evaluations} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
