import "server-only";

import { prisma } from "@/lib/db";
import { InMemoryRateLimiter, type RateLimiter, type RateLimitResult } from "@/lib/rate-limit/limiter";

const SWEEP_PROBABILITY = 0.01;

/**
 * Fixed-window counter shared by every server instance (P0 §12), stored in
 * the database Aegis already has (table `rate_limit_buckets`). One atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` per request — no read-then-
 * write race, so N instances together allow at most `limit` per window.
 *
 * Tradeoffs (docs/AEGIS_P0_IMPLEMENTATION.md §12):
 *   - adds one small write per API request to Postgres (an indexed upsert
 *     on a tiny table); fine at current scale, and the interface means a
 *     Redis/Upstash implementation can replace it with no caller changes;
 *   - windows are aligned to the epoch, so a burst straddling a boundary
 *     can see up to 2×limit across two adjacent windows (same as the
 *     in-memory limiter);
 *   - expired rows are swept opportunistically (~1% of calls), since there
 *     is no scheduler yet.
 *
 * Fails OPEN on a database error, logged: rate limiting protects capacity,
 * it isn't an authorization boundary — and if the database is down, the
 * request it guards can't succeed anyway.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly namespace: string,
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async consume(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / this.windowMs) * this.windowMs);
    const resetAt = new Date(windowStart.getTime() + this.windowMs);
    const bucketKey = `${this.namespace}:${key}`;

    try {
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "rate_limit_buckets" ("key", "windowStart", "count", "expiresAt")
        VALUES (${bucketKey}, ${windowStart}, 1, ${resetAt})
        ON CONFLICT ("key", "windowStart")
        DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1
        RETURNING "count"`;
      const count = Number(rows[0]?.count ?? 1);

      if (Math.random() < SWEEP_PROBABILITY) {
        prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => {});
      }

      return { allowed: count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - count), resetAt };
    } catch (error) {
      console.error(JSON.stringify({ msg: "rate_limiter_store_failed", namespace: this.namespace, error: String(error) }));
      return { allowed: true, limit: this.limit, remaining: this.limit, resetAt };
    }
  }
}

/**
 * Which store backs rate limits: RATE_LIMIT_BACKEND=postgres|memory.
 * Defaults to postgres in production (multi-instance serverless, where an
 * in-memory counter is per-instance and nearly meaningless) and memory
 * elsewhere (dev, tests).
 */
export function rateLimitBackend(): "postgres" | "memory" {
  const configured = process.env.RATE_LIMIT_BACKEND;
  if (configured === "postgres" || configured === "memory") return configured;
  return process.env.NODE_ENV === "production" ? "postgres" : "memory";
}

export function createRateLimiter(namespace: string, limit: number, windowMs: number): RateLimiter {
  return rateLimitBackend() === "postgres"
    ? new PostgresRateLimiter(namespace, limit, windowMs)
    : new InMemoryRateLimiter(limit, windowMs);
}

/** 60 requests/minute per API key — applied to every app/api/v1/* route via lib/api/handler.ts. */
export const apiRateLimiter: RateLimiter = createRateLimiter("api", 60, 60_000);
