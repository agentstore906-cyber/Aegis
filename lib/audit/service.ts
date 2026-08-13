import "server-only";

import type { Prisma } from "@prisma/client";

import type { PrismaOrTx } from "@/lib/db";
import type { RecordAuditEventInput } from "@/lib/audit/types";
import { redactSecrets } from "@/lib/security/redact";

export type { PrismaOrTx };

/**
 * The single write path into AuditEvent. Accepts a transaction client so
 * callers (evaluate.ts, approvals/service.ts, policy/agent Server Actions)
 * can record the audit row atomically alongside the mutation it describes,
 * rather than risking a mutation that succeeds with no audit trail behind
 * it. AuditEvent is append-only from the application's perspective — no
 * update/delete is ever exposed.
 *
 * `metadata` is redacted here, once, for every caller — some metadata
 * originates from caller-supplied context (e.g. policy/approval actions
 * echoing external API input), and this is the one place all of it funnels
 * through before hitting the database, so callers never have to remember
 * to redact themselves.
 */
export async function recordAuditEvent(client: PrismaOrTx, input: RecordAuditEventInput) {
  await client.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      agentId: input.agentId ?? null,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      result: input.result ?? "SUCCESS",
      metadata:
        input.metadata && Object.keys(input.metadata).length > 0
          ? (redactSecrets(input.metadata) as Prisma.InputJsonValue)
          : undefined,
      traceId: input.traceId ?? null,
    },
  });
}
