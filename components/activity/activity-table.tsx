import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ActivityStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { formatDateTime } from "@/lib/utils";
import type { ActivityEvent, Agent } from "@prisma/client";

type EventRow = ActivityEvent & { agent: Pick<Agent, "id" | "name" | "slug"> };

export function ActivityTable({ events }: { events: EventRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Timestamp</Th>
          <Th>Agent</Th>
          <Th>Action</Th>
          <Th>Resource</Th>
          <Th>Status</Th>
          <Th>Risk</Th>
          <Th>Duration</Th>
          <Th>Model</Th>
          <Th>Trace ID</Th>
        </Tr>
      </Thead>
      <Tbody>
        {events.map((event) => (
          <Tr key={event.id} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/activity/${event.id}`}
                className="focus-ring rounded-sm font-mono text-xs text-foreground hover:underline"
              >
                {formatDateTime(event.timestamp)}
              </Link>
            </Td>
            <Td>
              <Link
                href={`/agents/${event.agent.slug}`}
                className="font-medium text-foreground hover:underline"
              >
                {event.agent.name}
              </Link>
            </Td>
            <Td className="text-foreground">{event.action.replaceAll("_", " ")}</Td>
            <Td className="max-w-40 truncate text-muted-foreground">{event.resource ?? "—"}</Td>
            <Td>
              <ActivityStatusBadge status={event.status} />
            </Td>
            <Td>
              <RiskBadge level={event.riskLevel} />
            </Td>
            <Td className="tabular-nums text-muted-foreground">
              {event.durationMs != null ? `${event.durationMs}ms` : "—"}
            </Td>
            <Td className="text-muted-foreground">{event.modelName ?? "—"}</Td>
            <Td className="font-mono text-xs text-muted-foreground">
              {event.traceId ?? "—"}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
