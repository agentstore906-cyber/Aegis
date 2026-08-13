import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listApprovalRequests } from "@/lib/approvals/repository";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { approvalFiltersSchema } from "@/lib/validation/approval";

import { PageHeader } from "@/components/dashboard/page-header";
import { ApprovalFilters } from "@/components/approvals/approval-filters";
import { ApprovalsTable } from "@/components/approvals/approvals-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Approvals" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = approvalFiltersSchema.parse({
    status: typeof raw.status === "string" ? raw.status : undefined,
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    riskLevel: typeof raw.riskLevel === "string" ? raw.riskLevel : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [{ requests, total, pageCount }, agents] = await Promise.all([
    listApprovalRequests(organization.id, filters),
    listAllAgentsForOrg(organization.id),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.riskLevel) params.set("riskLevel", filters.riskLevel);
    if (filters.q) params.set("q", filters.q);
    params.set("page", String(page));
    return `/approvals?${params.toString()}`;
  };

  const isPendingView = filters.status === undefined || filters.status === "PENDING";

  return (
    <div>
      <PageHeader
        title="Approvals"
        description={`${total} ${isPendingView ? "pending " : ""}approval request${total === 1 ? "" : "s"} — actions Aegis routed to a human before they could proceed.`}
      />

      <div className="mb-4">
        <ApprovalFilters agents={agents} />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={isPendingView ? "Nothing needs your approval" : "No approval requests match your filters"}
          description={
            isPendingView
              ? "When a policy requires human sign-off, the request will show up here."
              : "Try adjusting your filters."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <ApprovalsTable requests={requests} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
