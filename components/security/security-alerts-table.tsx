import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { SecurityAlertSeverityBadge, SecurityAlertStatusBadge } from "@/components/dashboard/status-badges";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { SecurityAlert } from "@prisma/client";

type AlertRow = SecurityAlert & { agent: { id: string; name: string; slug: string } };

export function SecurityAlertsTable({ alerts }: { alerts: AlertRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Severity</Th>
          <Th>Agent</Th>
          <Th>Alert</Th>
          <Th>Count</Th>
          <Th>Last seen</Th>
          <Th>Status</Th>
        </Tr>
      </Thead>
      <Tbody>
        {alerts.map((alert) => (
          <Tr key={alert.id} className="hover:bg-surface-muted">
            <Td>
              <SecurityAlertSeverityBadge severity={alert.severity} />
            </Td>
            <Td>
              <Link
                href={`/agents/${alert.agent.slug}`}
                className="focus-ring rounded-sm font-medium text-foreground hover:underline"
              >
                {alert.agent.name}
              </Link>
            </Td>
            <Td>
              <Link href={`/security/${alert.id}`} className="focus-ring rounded-sm text-foreground hover:underline">
                {alert.title}
              </Link>
            </Td>
            <Td className="text-muted-foreground">{alert.count > 1 ? `×${alert.count}` : "—"}</Td>
            <Td className="text-xs text-muted-foreground" title={formatDateTime(alert.lastSeenAt)}>
              {formatRelativeTime(alert.lastSeenAt)}
            </Td>
            <Td>
              <SecurityAlertStatusBadge status={alert.status} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
