import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { auditFiltersSchema } from "@/lib/validation/audit";
import { createCsvResponse } from "@/lib/csv/export";
import { formatDateTime } from "@/lib/utils";
import { canExportAudit } from "@/lib/billing/entitlements";

/**
 * GET /audit/export — session-authenticated (dashboard user), not the
 * public API. Respects the same filters as the /audit list view. Streams
 * results via cursor pagination rather than loading the whole export into
 * memory — see lib/csv/export.ts.
 */
export async function GET(request: Request) {
  const { organization } = await requireActiveOrganization();

  const entitlement = canExportAudit(organization.plan);
  if (!entitlement.allowed) {
    return new Response(entitlement.reason, { status: 403 });
  }

  const url = new URL(request.url);
  const filters = auditFiltersSchema.parse({
    eventType: url.searchParams.get("eventType") ?? undefined,
    actorUserId: url.searchParams.get("actorUserId") ?? undefined,
    agentId: url.searchParams.get("agentId") ?? undefined,
    result: url.searchParams.get("result") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
  });

  const since =
    filters.range === "24h"
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : filters.range === "7d"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : filters.range === "30d"
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : undefined;

  const where: Prisma.AuditEventWhereInput = {
    organizationId: organization.id,
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  type Row = Prisma.AuditEventGetPayload<{
    include: { actorUser: { select: { name: true; email: true } }; agent: { select: { name: true } } };
  }>;

  return createCsvResponse<Row>({
    filename: `audit-${organization.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers: ["Timestamp", "Actor Type", "Actor", "Event Type", "Entity Type", "Entity ID", "Action", "Result", "Agent", "Trace ID"],
    getCursor: (row) => row.id,
    toRow: (row) => [
      formatDateTime(row.createdAt),
      row.actorType,
      row.actorUser?.name ?? row.actorUser?.email ?? "",
      row.eventType,
      row.entityType,
      row.entityId,
      row.action,
      row.result,
      row.agent?.name ?? "",
      row.traceId ?? "",
    ],
    fetchPage: (cursor, pageSize) =>
      prisma.auditEvent.findMany({
        where,
        include: {
          actorUser: { select: { name: true, email: true } },
          agent: { select: { name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
  });
}
