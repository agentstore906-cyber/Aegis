import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { AgentSpend } from "@/lib/costs/queries";

function ChangeCell({ changePercent }: { changePercent: number | null }) {
  if (changePercent === null) return <span className="text-muted-foreground">—</span>;
  const rounded = Math.round(changePercent);
  const tone = rounded > 0 ? "text-danger" : rounded < 0 ? "text-success" : "text-muted-foreground";
  const sign = rounded > 0 ? "+" : "";
  return <span className={tone}>{sign}{rounded}%</span>;
}

export function AgentSpendTable({ agents }: { agents: AgentSpend[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Agent</Th>
          <Th>Team</Th>
          <Th>Spend</Th>
          <Th>Requests</Th>
          <Th>Avg / request</Th>
          <Th>vs. last month</Th>
        </Tr>
      </Thead>
      <Tbody>
        {agents.map((agent) => (
          <Tr key={agent.agentId} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/agents/${agent.agentSlug}`}
                className="focus-ring rounded-sm font-medium text-foreground hover:underline"
              >
                {agent.agentName}
              </Link>
            </Td>
            <Td className="text-muted-foreground">{agent.teamName ?? "—"}</Td>
            <Td className="tabular-nums text-foreground">{formatCurrency(agent.spendCents)}</Td>
            <Td className="tabular-nums text-muted-foreground">{agent.eventCount}</Td>
            <Td className="tabular-nums text-muted-foreground">{formatCurrency(agent.avgCostCents)}</Td>
            <Td className="tabular-nums">
              <ChangeCell changePercent={agent.changePercent} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
