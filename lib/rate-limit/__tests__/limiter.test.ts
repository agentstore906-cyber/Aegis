import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";

describe("InMemoryRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", async () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i += 1) {
      const result = await limiter.consume("key-a");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests once the limit is exceeded within the window", async () => {
    const limiter = new InMemoryRateLimiter(2, 60_000);
    expect((await limiter.consume("key-b")).allowed).toBe(true);
    expect((await limiter.consume("key-b")).allowed).toBe(true);
    const third = await limiter.consume("key-b");
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("tracks each key independently", async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    expect((await limiter.consume("key-c")).allowed).toBe(true);
    expect((await limiter.consume("key-d")).allowed).toBe(true);
    expect((await limiter.consume("key-c")).allowed).toBe(false);
  });

  it("resets once the window elapses", async () => {
    const limiter = new InMemoryRateLimiter(1, 1_000);
    expect((await limiter.consume("key-e")).allowed).toBe(true);
    expect((await limiter.consume("key-e")).allowed).toBe(false);

    vi.advanceTimersByTime(1_001);

    expect((await limiter.consume("key-e")).allowed).toBe(true);
  });

  it("reports a resetAt timestamp in the future", async () => {
    const limiter = new InMemoryRateLimiter(5, 30_000);
    const result = await limiter.consume("key-f");
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
  });
});
