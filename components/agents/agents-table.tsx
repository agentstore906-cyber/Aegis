import Link from "next/link";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { AgentStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { Agent, AgentTool } from "@prisma/client";

type AgentRow = Agent & { tools: AgentTool[]; monthlySpendCents: number };

export function AgentsTable({ agents }: { agents: AgentRow[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Agent</Th>
          <Th>Status</Th>
          <Th>Owner</Th>
          <Th>Model</Th>
          <Th>Tools</Th>
          <Th>Risk</Th>
          <Th>Spend</Th>
          <Th>Last active</Th>
        </Tr>
      </Thead>
      <Tbody>
        {agents.map((agent) => (
          <Tr key={agent.id} className="hover:bg-surface-muted">
            <Td>
              <Link
                href={`/agents/${agent.slug}`}
                className="focus-ring rounded-sm font-medium text-foreground hover:underline"
              >
                {agent.name}
              </Link>
            </Td>
            <Td>
              <AgentStatusBadge status={agent.status} />
            </Td>
            <Td className="text-muted-foreground">{agent.owner}</Td>
            <Td className="text-muted-foreground">{agent.modelName}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {agent.tools.length === 0 && (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                {agent.tools.slice(0, 2).map((tool) => (
                  <Badge key={tool.id} tone="neutral">
                    {tool.name}
                  </Badge>
                ))}
                {agent.tools.length > 2 && (
                  <Badge tone="neutral">+{agent.tools.length - 2}</Badge>
                )}
              </div>
            </Td>
            <Td>
              <RiskBadge level={agent.riskLevel} />
            </Td>
            <Td className="tabular-nums text-muted-foreground">
              {formatCurrency(agent.monthlySpendCents)}
            </Td>
            <Td className="text-muted-foreground">
              {agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "Never"}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
