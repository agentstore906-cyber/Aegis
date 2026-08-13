import type { Metadata } from "next";
import { ClipboardList, Download } from "lucide-react";

import { requireActiveOrganization, listOrganizationMembers } from "@/lib/organizations/queries";
import { listAuditEvents, listDistinctAuditEventTypes } from "@/lib/audit/repository";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { auditFiltersSchema } from "@/lib/validation/audit";

import { PageHeader } from "@/components/dashboard/page-header";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Audit trail" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organization } = await requireActiveOrganization();
  const raw = await searchParams;

  const filters = auditFiltersSchema.parse({
    eventType: typeof raw.eventType === "string" ? raw.eventType : undefined,
    actorUserId: typeof raw.actorUserId === "string" ? raw.actorUserId : undefined,
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    result: typeof raw.result === "string" ? raw.result : undefined,
    range: typeof raw.range === "string" ? raw.range : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [{ events, total, pageCount }, eventTypes, agents, actors] = await Promise.all([
    listAuditEvents(organization.id, filters),
    listDistinctAuditEventTypes(organization.id),
    listAllAgentsForOrg(organization.id),
    listOrganizationMembers(organization.id),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.eventType) params.set("eventType", filters.eventType);
    if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
    if (filters.agentId) params.set("agentId", filters.agentId);
    if (filters.result) params.set("result", filters.result);
    if (filters.range) params.set("range", filters.range);
    params.set("page", String(page));
    return `/audit?${params.toString()}`;
  };

  const hasFilters = Boolean(
    filters.eventType || filters.actorUserId || filters.agentId || filters.result || filters.range
  );

  const exportParams = new URLSearchParams();
  if (filters.eventType) exportParams.set("eventType", filters.eventType);
  if (filters.actorUserId) exportParams.set("actorUserId", filters.actorUserId);
  if (filters.agentId) exportParams.set("agentId", filters.agentId);
  if (filters.result) exportParams.set("result", filters.result);
  if (filters.range) exportParams.set("range", filters.range);

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description={`${total} event${total === 1 ? "" : "s"} — every policy, permission, agent, and approval change, in order.`}
        action={
          <ButtonLink href={`/audit/export?${exportParams.toString()}`} variant="secondary" size="sm">
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </ButtonLink>
        }
      />

      <div className="mb-4">
        <AuditFilters eventTypes={eventTypes} agents={agents} actors={actors} />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasFilters ? "No audit events match your filters" : "No audit events yet"}
          description={
            hasFilters
              ? "Try adjusting your filters."
              : "Policy, permission, agent, and approval changes will appear here as they happen."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <AuditTable events={events} />
          <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />
        </div>
      )}
    </div>
  );
}
