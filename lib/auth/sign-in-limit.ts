import { CredentialsSignin } from "next-auth";

import { createRateLimiter } from "@/lib/rate-limit/postgres";
import { clientIpFromHeaders, UNKNOWN_CLIENT_IP } from "@/lib/http/client-ip-headers";
import { consumeClientLimit, emailBucketKey } from "@/lib/rate-limit/client-key";

/**
 * Sign-in throttling, enforced where credentials are VERIFIED (`authorize`, see lib/auth/credentials.ts), not in the
 * `signInAction` server action. The Auth.js handler also exposes `POST /api/auth/callback/credentials`, which reaches
 * `authorize` without ever touching a server action, so a limit that lives in the action can be skipped entirely.
 *
 * Two independent buckets, both consumed on every attempt (successful or not) BEFORE the password is checked:
 *   - per IP:        a single client cannot spray many accounts or burn bcrypt CPU;
 *   - per IP + email: a single client cannot hammer one account.
 * There is deliberately NO email-only bucket: it would let anyone lock a victim out of their own account by sending
 * bad attempts for their address (a cheap denial of service). The accepted consequence is that a distributed guesser
 * with many source IPs is limited per IP, not per account; bcrypt cost and the password policy are the remaining brake.
 *
 * When NO trustworthy client address exists (`unknown`), the per-IP buckets are NOT used: a shared "unknown" key could be
 * exhausted by anyone to block every user. Only a per-account bucket (hashed email, same 8 per 10 min) applies, with the
 * documented trade-off in lib/rate-limit/client-key.ts.
 *
 * The IP comes from `clientIpFromHeaders`, which trusts only platform-set headers (Vercel) or an operator-declared proxy depth,
 * never a raw client-supplied `X-Forwarded-For`; see that function for exactly what is and is not known about the caller.
 * State is shared across instances when RATE_LIMIT_BACKEND=postgres (the production default; see
 * lib/rate-limit/postgres.ts). With the in-memory backend (dev/tests) it is per process. The Postgres limiter fails OPEN
 * on a database error, which is acceptable here because sign-in itself needs the same database.
 */
export const signInIpLimiter = createRateLimiter("auth.sign_in.ip", 20, 10 * 60 * 1000);
export const signInIpEmailLimiter = createRateLimiter("auth.sign_in.ip_email", 8, 10 * 60 * 1000);

/** Thrown from `authorize`; the `code` is shown to the client in the redirect URL, so it names no account detail. */
export class SignInRateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

export const SIGN_IN_RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please try again later.";

/** Resolves when the attempt may proceed; throws `SignInRateLimitedError` when it may not. Never logs credentials. */
export async function enforceSignInLimit(request: Pick<Request, "headers"> | undefined, rawEmail: unknown): Promise<void> {
  const ip = request ? clientIpFromHeaders(request.headers) : UNKNOWN_CLIENT_IP;
  const emailKey = emailBucketKey(rawEmail);

  if (ip === UNKNOWN_CLIENT_IP) {
    // No trustworthy address: no shared bucket (see consumeClientLimit). Only the per-account bucket applies, keyed by the
    // email hash; a missing/unusable email is not limited here and never reaches the database or bcrypt (the schema rejects it).
    const result = await consumeClientLimit({ ip, ipLimiter: signInIpLimiter, emailLimiter: signInIpEmailLimiter, email: rawEmail });
    if (!result.allowed) throw new SignInRateLimitedError();
    return;
  }

  const [byIp, byIpEmail] = await Promise.all([
    signInIpLimiter.consume(ip),
    signInIpEmailLimiter.consume(`${ip}:${emailKey ?? "none"}`),
  ]);
  if (!byIp.allowed || !byIpEmail.allowed) throw new SignInRateLimitedError();
}
