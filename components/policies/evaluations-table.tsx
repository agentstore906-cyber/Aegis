import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DecisionBadge } from "@/components/dashboard/status-badges";
import { formatDateTime } from "@/lib/utils";
import type { PolicyEvaluation } from "@prisma/client";

type EvaluationRow = PolicyEvaluation & { agent: { id: string; name: string; slug: string } };

export function EvaluationsTable({ evaluations }: { evaluations: EvaluationRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Timestamp</Th>
          <Th>Agent</Th>
          <Th>Action</Th>
          <Th>Decision</Th>
          <Th>Matched policies</Th>
          <Th>Trace ID</Th>
        </Tr>
      </Thead>
      <Tbody>
        {evaluations.map((evaluation) => {
          const snapshots = (evaluation.matchedPolicySnapshots as unknown as
            | { id: string; name: string }[]
            | null) ?? [];
          return (
            <Tr key={evaluation.id} className="hover:bg-surface-muted">
              <Td>
                <Link
                  href={`/policies/evaluations/${evaluation.id}`}
                  className="focus-ring rounded-sm font-mono text-xs text-foreground hover:underline"
                >
                  {formatDateTime(evaluation.createdAt)}
                </Link>
              </Td>
              <Td>
                <Link href={`/agents/${evaluation.agent.slug}`} className="font-medium text-foreground hover:underline">
                  {evaluation.agent.name}
                </Link>
              </Td>
              <Td className="font-mono text-xs text-foreground">{evaluation.action}</Td>
              <Td>
                <DecisionBadge decision={evaluation.decision} />
              </Td>
              <Td className="max-w-56 truncate text-muted-foreground">
                {snapshots.length === 0 ? "—" : snapshots.map((s) => s.name).join(", ")}
              </Td>
              <Td className="font-mono text-xs text-muted-foreground">{evaluation.traceId ?? "—"}</Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
