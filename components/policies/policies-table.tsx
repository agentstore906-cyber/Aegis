import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DecisionBadge, PolicyStatusBadge } from "@/components/dashboard/status-badges";
import { PolicyRowActions } from "@/components/policies/policy-row-actions";
import { formatDateTime } from "@/lib/utils";
import type { Policy } from "@prisma/client";

type PolicyRow = Policy & { agent: { id: string; name: string; slug: string } | null };

export function PoliciesTable({ policies, canManage }: { policies: PolicyRow[]; canManage: boolean }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Name</Th>
          <Th>Status</Th>
          <Th>Decision</Th>
          <Th>Priority</Th>
          <Th>Scope</Th>
          <Th>Updated</Th>
          {canManage && <Th className="text-right">Actions</Th>}
        </Tr>
      </Thead>
      <Tbody>
        {policies.map((policy) => (
          <Tr key={policy.id} className="hover:bg-surface-muted">
            <Td className="font-medium text-foreground">{policy.name}</Td>
            <Td>
              <PolicyStatusBadge status={policy.status} />
            </Td>
            <Td>
              <DecisionBadge decision={policy.decision} />
            </Td>
            <Td className="tabular-nums text-muted-foreground">{policy.priority}</Td>
            <Td className="text-muted-foreground">
              {policy.agent ? policy.agent.name : "Any agent"}
              <span className="mx-1.5 text-border">·</span>
              <span className="font-mono text-xs">{policy.action}</span>
            </Td>
            <Td className="text-muted-foreground">{formatDateTime(policy.updatedAt)}</Td>
            {canManage && (
              <Td>
                <PolicyRowActions policyId={policy.id} name={policy.name} status={policy.status} />
              </Td>
            )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
