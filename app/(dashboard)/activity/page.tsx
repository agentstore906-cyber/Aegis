import type { Metadata } from "next";
import { Activity as ActivityIcon } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { listActivityEvents, listDistinctToolNames } from "@/lib/activity/queries";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { activityFiltersSchema } from "@/lib/validation/activity";

import { PageHeader } from "@/components/dashboard/page-header";
import { ActivityFilters } from "@/components/activity/activity-filters";
import { ActivityTable } from "@/components/activity/activity-table";
import { LiveActivityRefresh } from "@/components/activity/live-activity-refresh";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Activity" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = activityFiltersSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    riskLevel: typeof raw.riskLevel === "string" ? raw.riskLevel : undefined,
    eventType: typeof raw.eventType === "string" ? raw.eventType : undefined,
    toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
    range: typeof raw.range === "string" ? raw.range : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [{ events, total, pageCount }, agents, toolNames] = await Promise.all([
    listActivityEvents(organization.id, filters),
    listAllAgentsForOrg(organization.id),
    listDistinctToolNames(organization.id),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.status) params.set("status", filters.status);
    if (filters.riskLevel) params.set("riskLevel", filters.riskLevel);
    if (filters.eventType) params.set("eventType", filters.eventType);
    if (filters.toolName) params.set("toolName", filters.toolName);
    if (filters.range !== "all") params.set("range", filters.range);
    params.set("page", String(page));
    return `/activity?${params.toString()}`;
  };

  const hasFilters = Boolean(
    filters.q ||
      filters.agentId ||
      filters.status ||
      filters.riskLevel ||
      filters.eventType ||
      filters.toolName ||
      filters.range !== "all"
  );

  return (
    <div>
      <LiveActivityRefresh />
      <PageHeader
        title="Activity"
        description={`${total} event${total === 1 ? "" : "s"} across ${organization.name}'s agents. The page refreshes itself; there is no live stream.`}
      />

      <div className="mb-4">
        <ActivityFilters agents={agents} toolNames={toolNames} />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title={hasFilters ? "No events match your filters" : "No activity yet"}
          description={
            hasFilters
              ? "Try adjusting your search, filters, or time range."
              : "Agent actions will appear here as they happen."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <ActivityTable events={events} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
