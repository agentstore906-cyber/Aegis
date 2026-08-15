import type { Metadata } from "next";
import { MessageSquarePlus } from "lucide-react";

import { listAllFeatureRequests } from "@/lib/feedback/repository";
import { formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FeatureRequestStatusSelect } from "@/components/admin/feature-request-status-select";

export const metadata: Metadata = { title: "Feedback — Internal" };

export default async function AdminFeedbackPage() {
  const requests = await listAllFeatureRequests();

  const openCount = requests.filter((r) => r.status === "REQUESTED" || r.status === "REVIEWING").length;
  const plannedCount = requests.filter((r) => r.status === "PLANNED" || r.status === "IN_PROGRESS").length;
  const shippedCount = requests.filter((r) => r.status === "SHIPPED").length;

  return (
    <div>
      <PageHeader title="Feedback" description="Feature requests submitted by customers across every organization." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={String(requests.length)} icon={MessageSquarePlus} />
        <StatCard label="Open" value={String(openCount)} icon={MessageSquarePlus} tone={openCount ? "warning" : undefined} />
        <StatCard label="Planned / in progress" value={String(plannedCount)} icon={MessageSquarePlus} />
        <StatCard label="Shipped" value={String(shippedCount)} icon={MessageSquarePlus} />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="No feedback yet"
          description="Requests submitted from an organization's /feedback page will show up here."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Table>
            <Thead>
              <Tr>
                <Th>Submitted</Th>
                <Th>Request</Th>
                <Th>Organization</Th>
                <Th>Votes</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {requests.map((request) => (
                <Tr key={request.id}>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(request.createdAt)}</Td>
                  <Td>
                    <p className="font-medium">{request.title}</p>
                    {request.category && <Badge tone="neutral">{request.category}</Badge>}
                  </Td>
                  <Td className="text-xs">{request.organization.name}</Td>
                  <Td className="text-xs tabular-nums">{request._count.votes}</Td>
                  <Td>
                    <FeatureRequestStatusSelect id={request.id} status={request.status} />
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
