import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DecisionBadge } from "@/components/dashboard/status-badges";
import { formatDateTime } from "@/lib/utils";
import { PermissionRowActions } from "@/components/policies/permission-row-actions";
import type { AgentPermission } from "@prisma/client";

export function PermissionsTable({
  permissions,
  agentSlug,
  canManage,
}: {
  permissions: AgentPermission[];
  agentSlug: string;
  canManage: boolean;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Action</Th>
          <Th>Resource</Th>
          <Th>Decision</Th>
          <Th>Description</Th>
          <Th>Updated</Th>
          {canManage && <Th className="text-right">Actions</Th>}
        </Tr>
      </Thead>
      <Tbody>
        {permissions.map((permission) => (
          <Tr key={permission.id} className="hover:bg-surface-muted">
            <Td className="font-mono text-xs text-foreground">{permission.action}</Td>
            <Td className="text-muted-foreground">{permission.resource || "Any"}</Td>
            <Td>
              <DecisionBadge decision={permission.decision} />
            </Td>
            <Td className="max-w-64 truncate text-muted-foreground">
              {permission.description || "—"}
            </Td>
            <Td className="text-muted-foreground">{formatDateTime(permission.updatedAt)}</Td>
            {canManage && (
              <Td>
                <PermissionRowActions
                  agentSlug={agentSlug}
                  permissionId={permission.id}
                  action={permission.action}
                />
              </Td>
            )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
