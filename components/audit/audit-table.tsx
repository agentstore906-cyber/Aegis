import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { AuditResultBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { AuditEvent } from "@prisma/client";

type AuditRow = AuditEvent & {
  actorUser: { id: string; name: string | null; email: string } | null;
  agent: { id: string; name: string; slug: string } | null;
};

export function AuditTable({ events }: { events: AuditRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Timestamp</Th>
          <Th>Actor</Th>
          <Th>Event</Th>
          <Th>Agent / Entity</Th>
          <Th>Result</Th>
          <Th>Trace ID</Th>
        </Tr>
      </Thead>
      <Tbody>
        {events.map((event) => (
          <Tr key={event.id} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/audit/${event.id}`}
                className="focus-ring rounded-sm font-mono text-xs text-foreground hover:underline"
              >
                {formatDateTime(event.createdAt)}
              </Link>
            </Td>
            <Td>
              {event.actorType === "USER" ? (
                <span className="text-foreground">{event.actorUser?.name ?? event.actorUser?.email ?? "Unknown user"}</span>
              ) : (
                <Badge tone="neutral">{event.actorType === "SYSTEM" ? "Aegis" : "Agent"}</Badge>
              )}
            </Td>
            <Td className="font-mono text-xs text-foreground">{event.eventType}</Td>
            <Td className="text-muted-foreground">
              {event.agent ? (
                <Link href={`/agents/${event.agent.slug}`} className="focus-ring rounded-sm hover:underline">
                  {event.agent.name}
                </Link>
              ) : (
                `${event.entityType} · ${event.entityId.slice(0, 8)}`
              )}
            </Td>
            <Td>
              <AuditResultBadge result={event.result} />
            </Td>
            <Td className="font-mono text-xs text-muted-foreground">{event.traceId ?? "—"}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
