/**
 * Rate limiting for the public API (app/api/v1/*). Interface-first so an
 * in-memory implementation can be swapped for a Redis-backed one later
 * without touching call sites — see the class doc below for why in-memory
 * is an acceptable starting point, not a permanent choice.
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
};

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Fixed-window counter per key, kept in a plain Map. Good enough for a
 * single Node process; known limitation: state is not shared across
 * server instances or serverless cold starts, so a multi-instance
 * deployment would let each instance independently allow up to `limit`
 * requests. Swapping in a Redis (e.g. `INCR` + `EXPIRE`) implementation of
 * this same `RateLimiter` interface is the intended upgrade path — no
 * caller needs to change.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; windowStart: number }>();
  private lastSweep = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async consume(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweepIfDue(now);

    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { count: 0, windowStart: now };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;

    return {
      allowed: bucket.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: new Date(bucket.windowStart + this.windowMs),
    };
  }

  /** Drops expired buckets periodically so long-lived processes don't accumulate one-off keys forever. */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}

/** 60 requests/minute per API key — applied to every app/api/v1/* route via lib/api/handler.ts. */
export const apiRateLimiter: RateLimiter = new InMemoryRateLimiter(60, 60_000);
