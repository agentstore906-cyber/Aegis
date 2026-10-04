import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** An unfinished claim older than this is treated as abandoned (crashed process) and may be re-claimed. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export type IdempotentResult = { status: number; body: unknown };

/**
 * Wraps a mutating operation (event ingestion, policy evaluation, agent
 * registration) so a caller-supplied `Idempotency-Key` makes retries safe:
 * the same key with an equivalent body replays the original response
 * instead of re-running the handler — so a retried POST /evaluate never
 * creates a second evaluation, ActivityEvent, or ApprovalRequest. The same
 * key with a *different* body is a caller bug, not a retry (409).
 *
 * CLAIM FIRST (P0). The key is reserved by inserting the record *before*
 * the handler runs; the unique constraint on (apiKeyId, operation, key)
 * means exactly one concurrent request wins the claim and runs the handler.
 * A concurrent duplicate that loses the claim gets 409
 * IDEMPOTENCY_KEY_IN_PROGRESS (retryable — the SDK backs off and retries,
 * and then gets the replayed result) rather than running the handler a
 * second time. The previous check-then-write version let two in-flight
 * retries both execute.
 *
 * Failures: if the handler throws, the claim is released so a retry can run
 * it again (only successful completions are cached). Expired records
 * (older than 24h) are treated as absent.
 *
 * No key = no deduplication: two requests without a key are two legitimate,
 * separate executions. The SDK generates a key per logical call.
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
  const where = { apiKeyId_operation_key: { apiKeyId, operation, key: idempotencyKey } };

  const claimed = await claim();
  if (!claimed) {
    const existing = await prisma.idempotencyRecord.findUnique({ where });
    if (!existing) {
      // Released between our failed claim and this read (the holder's
      // handler failed). Retrying is correct; don't run the handler blind.
      throw inProgressError();
    }
    if (existing.requestHash !== requestHash) {
      throw new ApiError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "This Idempotency-Key was already used with a different request body.",
        409
      );
    }
    if (!existing.completedAt) throw inProgressError();
    return { status: existing.statusCode, body: existing.responseBody };
  }

  let result: IdempotentResult;
  try {
    result = await handler();
  } catch (error) {
    await prisma.idempotencyRecord.deleteMany({ where: { apiKeyId, operation, key: idempotencyKey, completedAt: null } }).catch(() => {});
    throw error;
  }

  await prisma.idempotencyRecord
    .update({
      where,
      data: {
        statusCode: result.status,
        responseBody: result.body as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      // The work is done and its result is correct; failing to cache it only
      // means a later retry can't replay it. Never fail the response for it.
      console.error(
        JSON.stringify({ msg: "idempotency_record_write_failed", apiKeyId, operation, error: String(error) })
      );
    });

  return result;

  /** Returns true if this request now owns the key. */
  async function claim(): Promise<boolean> {
    const now = new Date();
    // Clear records that no longer protect anything: expired ones, and
    // claims abandoned mid-flight (the process died before completing or
    // releasing them) — otherwise a crash would wedge the key as "in
    // progress" for 24h. No real handler runs anywhere near this long.
    await prisma.idempotencyRecord.deleteMany({
      where: {
        apiKeyId,
        operation,
        key: idempotencyKey!,
        OR: [
          { expiresAt: { lte: now } },
          { completedAt: null, createdAt: { lte: new Date(now.getTime() - STALE_CLAIM_MS) } },
        ],
      },
    });
    try {
      await prisma.idempotencyRecord.create({
        data: {
          organizationId,
          apiKeyId,
          operation,
          key: idempotencyKey!,
          requestHash,
          statusCode: 0,
          responseBody: {},
          completedAt: null,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
}

function inProgressError(): ApiError {
  return new ApiError(
    "IDEMPOTENCY_KEY_IN_PROGRESS",
    "A request with this Idempotency-Key is still being processed. Retry shortly to receive its result.",
    409
  );
}
