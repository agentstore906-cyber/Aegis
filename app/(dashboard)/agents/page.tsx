import type { Metadata } from "next";
import { Bot, Plus } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAgents } from "@/lib/agents/queries";
import { agentFiltersSchema } from "@/lib/validation/agent";

import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { AgentFilters } from "@/components/agents/agent-filters";
import { AgentsTable } from "@/components/agents/agents-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Agents" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = agentFiltersSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    riskLevel: typeof raw.riskLevel === "string" ? raw.riskLevel : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const { agents, total, pageCount } = await listAgents(organization.id, filters);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.riskLevel) params.set("riskLevel", filters.riskLevel);
    params.set("page", String(page));
    return `/agents?${params.toString()}`;
  };

  const hasFilters = Boolean(filters.q || filters.status || filters.riskLevel);

  return (
    <div>
      <PageHeader
        title="Agents"
        description={`${total} agent${total === 1 ? "" : "s"} in ${organization.name}`}
        action={
          <ButtonLink href="/agents/new">
            <Plus className="size-4" aria-hidden="true" />
            Create agent
          </ButtonLink>
        }
      />

      <div className="mb-4">
        <AgentFilters />
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={hasFilters ? "No agents match your filters" : "No agents yet"}
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Create your first agent to start monitoring its activity."
          }
          action={
            !hasFilters && (
              <ButtonLink href="/agents/new" size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Create agent
              </ButtonLink>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <AgentsTable agents={agents} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
