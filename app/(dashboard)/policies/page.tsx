import type { Metadata } from "next";
import { ShieldCheck, Plus, FlaskConical, History } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listPolicies } from "@/lib/policies/repository";
import { canManagePolicies } from "@/lib/policies/authorization";
import { policyFiltersSchema } from "@/lib/validation/policy";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { PolicyFilters } from "@/components/policies/policy-filters";
import { PoliciesTable } from "@/components/policies/policies-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Policies" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = policyFiltersSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    decision: typeof raw.decision === "string" ? raw.decision : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const { policies, total, pageCount } = await listPolicies(organization.id, filters);
  const canManage = canManagePolicies(role);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.decision) params.set("decision", filters.decision);
    params.set("page", String(page));
    return `/policies?${params.toString()}`;
  };

  const hasFilters = Boolean(filters.q || filters.status || filters.decision);

  return (
    <div>
      <PageHeader
        title="Policies"
        description={`${total} polic${total === 1 ? "y" : "ies"} — define the rules every agent must follow.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/policies/evaluations" variant="secondary" size="sm">
              <History className="size-4" aria-hidden="true" />
              Evaluation history
            </ButtonLink>
            <ButtonLink href="/policies/test" variant="secondary" size="sm">
              <FlaskConical className="size-4" aria-hidden="true" />
              Policy tester
            </ButtonLink>
            {canManage && (
              <ButtonLink href="/policies/new" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Create policy
              </ButtonLink>
            )}
          </div>
        }
      />

      <div className="mb-4">
        <PolicyFilters />
      </div>

      {policies.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={hasFilters ? "No policies match your filters" : "No policies yet"}
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Add conditional rules for sensitive agent actions."
          }
          action={
            !hasFilters &&
            canManage && (
              <ButtonLink href="/policies/new" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Create policy
              </ButtonLink>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <PoliciesTable policies={policies} canManage={canManage} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
