import type { Metadata } from "next";
import { Bot, Plus } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listAgents } from "@/lib/agents/queries";
import { getAgentListSignals } from "@/lib/agents/list-signals";
import { canManageAgents } from "@/lib/agents/authorization";
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
  const { organization, role } = await requireActiveOrganization();
  const canManage = canManageAgents(role);
  const raw = await searchParams;

  const filters = agentFiltersSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    riskLevel: typeof raw.riskLevel === "string" ? raw.riskLevel : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const { agents: rows, total, pageCount } = await listAgents(organization.id, filters);
  const signals = await getAgentListSignals(
    organization.id,
    rows.map((a) => a.id)
  );
  const agents = rows.map((a) => ({ ...a, signals: signals.get(a.id) }));

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
        title="Your AI agents"
        description={agents.length === 0 && !hasFilters ? "Connect your first AI agent to Aegis." : undefined}
        action={
          canManage && (
            <ButtonLink href="/agents/new">
              <Plus className="size-4" aria-hidden="true" />
              Connect Agent
            </ButtonLink>
          )
        }
      />

      {(hasFilters || total > 8) && (
        <div className="mb-4">
          <AgentFilters />
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={hasFilters ? "No agents match your filters" : "No AI agents yet"}
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Connect your agent to Aegis in under 60 seconds."
          }
          action={
            !hasFilters && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canManage && (
                  <ButtonLink href="/agents/new" size="sm">
                    <Plus className="size-4" aria-hidden="true" />
                    Connect Agent
                  </ButtonLink>
                )}
              </div>
            )
          }
        />
      ) : (
        <>
          <AgentsTable agents={agents} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
          {canManage && !hasFilters && (
            <div className="mt-6">
              <ButtonLink href="/agents/new" variant="secondary">
                <Plus className="size-4" aria-hidden="true" />
                Connect another agent
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}
