import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { DemoAgentStatusBadge } from "../badges";
import { useDemo } from "../demo-context";

export function AgentsView() {
  const { agents, openAgent } = useDemo();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">{agents.length} agents in this workspace.</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <Thead>
            <Tr>
              <Th>Agent</Th>
              <Th>Status</Th>
              <Th>Runs</Th>
              <Th>Cost</Th>
              <Th>Success rate</Th>
              <Th>Last active</Th>
            </Tr>
          </Thead>
          <Tbody>
            {agents.map((agent) => (
              <Tr key={agent.id}>
                <Td className="p-0">
                  <button
                    type="button"
                    onClick={() => openAgent(agent.id)}
                    className="focus-ring block w-full px-4 py-3 text-left"
                  >
                    <p className="font-medium text-foreground">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{agent.role}</p>
                  </button>
                </Td>
                <Td>
                  <DemoAgentStatusBadge status={agent.status} />
                </Td>
                <Td className="tabular-nums">{agent.runs.toLocaleString()}</Td>
                <Td className="tabular-nums">{formatCurrency(agent.costCents)}</Td>
                <Td className="tabular-nums">{agent.successRate.toFixed(1)}%</Td>
                <Td className="text-muted-foreground">{formatRelativeTime(agent.lastActiveAt)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
