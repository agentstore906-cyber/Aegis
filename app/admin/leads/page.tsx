import type { Metadata } from "next";
import { Users } from "lucide-react";
import type { LeadStatus } from "@prisma/client";

import { listLeads } from "@/lib/leads/repository";
import { LEAD_STATUSES } from "@/lib/validation/lead";
import { formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { LeadStatusSelect } from "@/components/admin/lead-status-select";

export const metadata: Metadata = { title: "Leads — Internal" };

type SearchParams = Record<string, string | string[] | undefined>;

function isLeadStatus(value: string | undefined): value is LeadStatus {
  return LEAD_STATUSES.includes(value as LeadStatus);
}

export default async function AdminLeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const statusFilter = typeof raw.status === "string" && isLeadStatus(raw.status) ? raw.status : undefined;

  const [allLeads, filteredLeads] = await Promise.all([
    listLeads(),
    statusFilter ? listLeads(statusFilter) : Promise.resolve(null),
  ]);

  const leads = filteredLeads ?? allLeads;
  const counts = LEAD_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = allLeads.filter((lead) => lead.status === status).length;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title="Leads" description="Demo requests and contact submissions from aegis.example/contact." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="New" value={String(counts.NEW ?? 0)} icon={Users} tone={counts.NEW ? "warning" : undefined} />
        <StatCard label="Qualified" value={String(counts.QUALIFIED ?? 0)} icon={Users} />
        <StatCard label="Demo scheduled" value={String(counts.DEMO_SCHEDULED ?? 0)} icon={Users} />
        <StatCard label="Customer" value={String(counts.CUSTOMER ?? 0)} icon={Users} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <ButtonLink href="/admin/leads" variant={!statusFilter ? "primary" : "secondary"} size="sm">
          All ({allLeads.length})
        </ButtonLink>
        {LEAD_STATUSES.map((status) => (
          <ButtonLink
            key={status}
            href={`/admin/leads?status=${status}`}
            variant={statusFilter === status ? "primary" : "secondary"}
            size="sm"
          >
            {status.replace("_", " ")} ({counts[status] ?? 0})
          </ButtonLink>
        ))}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Submissions from /contact will show up here as they come in."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Table>
            <Thead>
              <Tr>
                <Th>Received</Th>
                <Th>Name</Th>
                <Th>Company / role</Th>
                <Th>Agents</Th>
                <Th>Challenge</Th>
                <Th>Source</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {leads.map((lead) => (
                <Tr key={lead.id}>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(lead.createdAt)}</Td>
                  <Td>
                    <p className="font-medium">{lead.name}</p>
                    <a href={`mailto:${lead.email}`} className="text-xs text-muted-foreground underline">
                      {lead.email}
                    </a>
                  </Td>
                  <Td>
                    <p>{lead.company}</p>
                    <p className="text-xs text-muted-foreground">{lead.role}</p>
                  </Td>
                  <Td className="text-xs">{lead.agentCount ?? "—"}</Td>
                  <Td className="text-xs">{lead.primaryChallenge ?? "—"}</Td>
                  <Td>
                    <Badge tone="neutral">{lead.source.replace("_", " ")}</Badge>
                  </Td>
                  <Td>
                    <LeadStatusSelect id={lead.id} status={lead.status} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
