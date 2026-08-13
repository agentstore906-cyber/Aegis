import type { Prisma, SecurityAlertSeverity, SecurityAlertStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewSecurityAlerts } from "@/lib/security/authorization";
import { securityAlertFiltersSchema } from "@/lib/validation/security";
import { createCsvResponse } from "@/lib/csv/export";
import { formatDateTime } from "@/lib/utils";

/** GET /security/export — session-authenticated, respects the same filters as the /security list view. */
export async function GET(request: Request) {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewSecurityAlerts(role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const filters = securityAlertFiltersSchema.parse({
    status: url.searchParams.get("status") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined,
    agentId: url.searchParams.get("agentId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
  });

  const where: Prisma.SecurityAlertWhereInput = {
    organizationId: organization.id,
    ...(filters.status ? { status: filters.status as SecurityAlertStatus } : {}),
    ...(filters.severity ? { severity: filters.severity as SecurityAlertSeverity } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  type Row = Prisma.SecurityAlertGetPayload<{ include: { agent: { select: { name: true } } } }>;

  return createCsvResponse<Row>({
    filename: `security-alerts-${organization.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers: ["First Seen", "Last Seen", "Severity", "Status", "Type", "Agent", "Title", "Count", "Trace ID"],
    getCursor: (row) => row.id,
    toRow: (row) => [
      formatDateTime(row.firstSeenAt),
      formatDateTime(row.lastSeenAt),
      row.severity,
      row.status,
      row.type,
      row.agent.name,
      row.title,
      row.count,
      row.traceId ?? "",
    ],
    fetchPage: (cursor, pageSize) =>
      prisma.securityAlert.findMany({
        where,
        include: { agent: { select: { name: true } } },
        orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
  });
}
