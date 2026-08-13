import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RevokeApiKeyButton } from "@/components/api-keys/revoke-api-key-button";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { ApiKey } from "@prisma/client";

function KeyStatusBadge({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.revokedAt) return <Badge tone="danger">Revoked</Badge>;
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) return <Badge tone="neutral">Expired</Badge>;
  return (
    <Badge tone="success" dot>
      Active
    </Badge>
  );
}

export function ApiKeysTable({ apiKeys, canManage }: { apiKeys: ApiKey[]; canManage: boolean }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Name</Th>
          <Th>Key</Th>
          <Th>Environment</Th>
          <Th>Status</Th>
          <Th>Last used</Th>
          <Th>Created</Th>
          <Th>Expires</Th>
          {canManage && <Th>
            <span className="sr-only">Actions</span>
          </Th>}
        </Tr>
      </Thead>
      <Tbody>
        {apiKeys.map((apiKey) => (
          <Tr key={apiKey.id} className="hover:bg-surface-muted">
            <Td className="font-medium text-foreground">{apiKey.name}</Td>
            <Td className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</Td>
            <Td>
              <Badge tone={apiKey.environment === "LIVE" ? "brand" : "neutral"}>
                {apiKey.environment === "LIVE" ? "Live" : "Test"}
              </Badge>
            </Td>
            <Td>
              <KeyStatusBadge apiKey={apiKey} />
            </Td>
            <Td className="text-xs text-muted-foreground">
              {apiKey.lastUsedAt ? formatRelativeTime(apiKey.lastUsedAt) : "Never"}
            </Td>
            <Td className="text-xs text-muted-foreground">{formatDateTime(apiKey.createdAt)}</Td>
            <Td className="text-xs text-muted-foreground">
              {apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : "Never"}
            </Td>
            {canManage && (
              <Td>
                {!apiKey.revokedAt && <RevokeApiKeyButton id={apiKey.id} name={apiKey.name} />}
              </Td>
            )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
