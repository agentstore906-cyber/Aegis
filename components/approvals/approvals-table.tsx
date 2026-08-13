import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ApprovalStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { ApprovalRequest, RiskLevel } from "@prisma/client";

type ApprovalRow = ApprovalRequest & { agent: { id: string; name: string; slug: string } };

export function ApprovalsTable({ requests }: { requests: ApprovalRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Agent</Th>
          <Th>Action</Th>
          <Th>Resource</Th>
          <Th>Risk</Th>
          <Th>Requested</Th>
          <Th>Status</Th>
        </Tr>
      </Thead>
      <Tbody>
        {requests.map((request) => (
          <Tr key={request.id} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/agents/${request.agent.slug}`}
                className="focus-ring rounded-sm font-medium text-foreground hover:underline"
              >
                {request.agent.name}
              </Link>
            </Td>
            <Td>
              <Link
                href={`/approvals/${request.id}`}
                className="focus-ring rounded-sm font-mono text-xs text-foreground hover:underline"
              >
                {request.action}
              </Link>
            </Td>
            <Td className="max-w-48 truncate text-muted-foreground">{request.resource ?? "—"}</Td>
            <Td>{request.riskLevel ? <RiskBadge level={request.riskLevel as RiskLevel} /> : "—"}</Td>
            <Td className="text-xs text-muted-foreground" title={formatDateTime(request.requestedAt)}>
              {formatRelativeTime(request.requestedAt)}
            </Td>
            <Td>
              <ApprovalStatusBadge status={request.status} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
