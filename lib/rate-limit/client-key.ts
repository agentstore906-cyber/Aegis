import "server-only";

import { createHash } from "node:crypto";

import { UNKNOWN_CLIENT_IP } from "@/lib/http/client-ip-headers";
import type { RateLimiter, RateLimitResult } from "@/lib/rate-limit/limiter";

/** A hashed, normalised email for use in a bucket key (the bucket table never holds addresses), or null when it is not usable as one. */
export function emailBucketKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !normalized.includes("@")) return null;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

let warnedUntrusted = false;
/** Once per process: the operator must hear that per-IP limits are not in effect. Logs no header, address or request data. */
function warnUntrustedClientIpOnce(): void {
  if (warnedUntrusted) return;
  warnedUntrusted = true;
  console.warn(
    JSON.stringify({
      msg: "client_ip_untrusted",
      detail: "No trustworthy client IP for a rate-limited request: per-IP limits are not applied, per-email limits are. Deploy on Vercel or set AEGIS_TRUSTED_PROXY_HOPS (docs/deployment.md).",
    })
  );
}

const NOT_LIMITED = (): RateLimitResult => ({ allowed: true, limit: 0, remaining: 0, resetAt: new Date() });

/**
 * Consumes the right bucket for a request whose caller is identified by a client IP when one can be trusted.
 *
 *   - Trusted IP: the per-IP limiter, exactly as before.
 *   - NO trusted IP (`unknown`): there is deliberately NO shared bucket. Every unidentified caller would otherwise share
 *     one key, and anyone could exhaust it with a few requests and block every legitimate user site-wide. Instead the
 *     request is limited per (hashed) email when an `emailLimiter` is given, and not by this function otherwise.
 *     An unusable email means the caller's own validation rejects the request before any costly work.
 *
 * Trade-off, stated plainly: without a trusted address an attacker can rotate emails to get past per-email limits, so abuse
 * volume is bounded only by the platform in that configuration. Per-email limits also let someone slow one victim's own
 * attempts for the window. The remedy is configuration, not code: see `clientIpFromHeaders`.
 */
export async function consumeClientLimit(options: {
  ip: string;
  ipLimiter: RateLimiter;
  emailLimiter?: RateLimiter;
  email?: unknown;
}): Promise<RateLimitResult> {
  if (options.ip !== UNKNOWN_CLIENT_IP) return options.ipLimiter.consume(options.ip);

  warnUntrustedClientIpOnce();
  const emailKey = options.emailLimiter ? emailBucketKey(options.email) : null;
  return options.emailLimiter && emailKey ? options.emailLimiter.consume(emailKey) : NOT_LIMITED();
}
