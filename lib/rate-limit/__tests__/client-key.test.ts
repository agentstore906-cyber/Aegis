import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";
import { consumeClientLimit, emailBucketKey } from "@/lib/rate-limit/client-key";
import { clientIpFromHeaders } from "@/lib/http/client-ip-headers";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const limiters = () => ({
  ipLimiter: new InMemoryRateLimiter(5, 60_000),
  emailLimiter: new InMemoryRateLimiter(3, 60_000),
});

describe("consumeClientLimit — no shared 'unknown' bucket (M3 follow-up 3)", () => {
  it("a trusted IP uses the per-IP limiter exactly as before", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    const spy = vi.spyOn(emailLimiter, "consume");
    for (let i = 0; i < 5; i += 1) expect((await consumeClientLimit({ ip: "1.2.3.4", ipLimiter, emailLimiter, email: "a@example.com" })).allowed).toBe(true);
    expect((await consumeClientLimit({ ip: "1.2.3.4", ipLimiter, emailLimiter, email: "a@example.com" })).allowed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    // another client is unaffected
    expect((await consumeClientLimit({ ip: "5.6.7.8", ipLimiter, emailLimiter, email: "a@example.com" })).allowed).toBe(true);
  });

  it("REGRESSION: unknown-IP requests never touch the per-IP limiter, so nobody can exhaust a global bucket", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    const spy = vi.spyOn(ipLimiter, "consume");
    // An attacker sends far more than the old 5-per-hour limit, each with a fresh email.
    for (let i = 0; i < 500; i += 1) expect((await consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email: `bot${i}@example.com` })).allowed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    // A legitimate user arriving afterwards is not blocked.
    expect((await consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email: "real.person@example.com" })).allowed).toBe(true);
  });

  it("unknown IP: abuse of ONE address is still capped per email, and other emails are independent", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    const take = (email: string) => consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email });
    for (let i = 0; i < 3; i += 1) expect((await take("victim@example.com")).allowed).toBe(true);
    expect((await take("victim@example.com")).allowed).toBe(false);
    expect((await take("VICTIM@example.com ")).allowed).toBe(false); // case/whitespace variants share the bucket
    expect((await take("other@example.com")).allowed).toBe(true);
  });

  it("attacker header rotation cannot create or avoid anything: forged forwarding headers all resolve to 'unknown'", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    const spy = vi.spyOn(ipLimiter, "consume");
    for (let i = 0; i < 50; i += 1) {
      const ip = clientIpFromHeaders(new Headers({ "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `203.0.113.${i}` }), {});
      expect(ip).toBe("unknown");
      await consumeClientLimit({ ip, ipLimiter, emailLimiter, email: "same@example.com" });
    }
    expect(spy).not.toHaveBeenCalled();
    // rotating headers did not evade the per-email cap
    expect((await consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email: "same@example.com" })).allowed).toBe(false);
  });

  it("unknown IP with no usable email, or no email limiter, is not limited here (the caller's validation / own cap applies)", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    for (const email of [undefined, null, "", "   ", "no-at-sign", 42, { a: 1 }, `${"x".repeat(400)}@example.com`]) {
      for (let i = 0; i < 20; i += 1) expect((await consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email })).allowed).toBe(true);
    }
    for (let i = 0; i < 20; i += 1) expect((await consumeClientLimit({ ip: "unknown", ipLimiter, email: "a@example.com" })).allowed).toBe(true);
  });

  it("warns at most once per process that per-IP limits are off, without logging any request data", async () => {
    const { ipLimiter, emailLimiter } = limiters();
    for (let i = 0; i < 5; i += 1) await consumeClientLimit({ ip: "unknown", ipLimiter, emailLimiter, email: `w${i}@example.com` });
    const lines = warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("client_ip_untrusted"));
    expect(lines.length).toBeLessThanOrEqual(1); // module-level flag: never repeated within a process
    for (const line of lines) expect(line).not.toMatch(/@example\.com|198\.51\.100|x-forwarded/i);
  });
});

describe("emailBucketKey", () => {
  it("hashes, normalises, and refuses unusable input", () => {
    const key = emailBucketKey("  Person@Example.com ");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toBe(emailBucketKey("person@example.com"));
    expect(key).not.toContain("person");
    for (const bad of [undefined, null, 5, "", "ab", "no-at", "a".repeat(321)]) expect(emailBucketKey(bad)).toBeNull();
  });
});
