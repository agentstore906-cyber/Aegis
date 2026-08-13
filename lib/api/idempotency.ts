import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export type IdempotentResult = { status: number; body: unknown };

/**
 * Wraps a mutating operation (event ingestion, policy evaluation) so a
 * caller-supplied `Idempotency-Key` makes retries safe: the same key with
 * an equivalent body replays the original response instead of re-running
 * the handler (so a retried POST /evaluate never creates a second
 * ApprovalRequest — evaluateAgentAction() always creates a fresh
 * PolicyEvaluation, so the dedup has to happen up here, before the
 * handler runs a second time). The same key with a *different* body is
 * treated as a caller bug, not a valid retry, and rejected with 409.
 *
 * Scope note: only successful completions (the handler resolving
 * normally) are cached and replayed. A thrown error is not cached, so a
 * retry after a transient failure re-runs the handler rather than
 * replaying the failure — this is the more useful behavior for the
 * failure case, and keeps this wrapper simple.
 */
export async function withIdempotency(
  params: {
    organizationId: string;
    apiKeyId: string;
    operation: string;
    idempotencyKey: string | null;
    requestBody: unknown;
  },
  handler: () => Promise<IdempotentResult>
): Promise<IdempotentResult> {
  const { organizationId, apiKeyId, operation, idempotencyKey, requestBody } = params;
  if (!idempotencyKey) return handler();

  const requestHash = hashRequestBody(requestBody);

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { apiKeyId_operation_key: { apiKeyId, operation, key: idempotencyKey } },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "This Idempotency-Key was already used with a different request body.",
        409
      );
    }
    return { status: existing.statusCode, body: existing.responseBody };
  }

  const result = await handler();

  await prisma.idempotencyRecord
    .create({
      data: {
        organizationId,
        apiKeyId,
        operation,
        key: idempotencyKey,
        requestHash,
        statusCode: result.status,
        responseBody: result.body as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    })
    .catch((error: unknown) => {
      // Best-effort cache write. A unique-constraint race here means two
      // concurrent identical retries both already got the correct result
      // from `handler()` above — safe to ignore, not safe to crash on.
      console.error(
        JSON.stringify({ msg: "idempotency_record_write_failed", apiKeyId, operation, error: String(error) })
      );
    });

  return result;
}
