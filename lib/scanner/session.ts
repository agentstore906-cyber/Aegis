import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Anonymous scan ownership. A visitor gets a random 256-bit token in an httpOnly cookie; only its
 * SHA-256 hash is stored (so a database read can't be replayed as a session). Whoever holds the
 * cookie owns the anonymous scans created under it — and can claim them into an account later.
 *
 * Losing the cookie (cleared storage, another device) means losing access to the private report.
 * That is deliberate: report ids alone are not credentials. The UI handles that state explicitly.
 */
export const SCAN_SESSION_COOKIE = "aegis_scan_session";
export const SCAN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const hashSessionToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

/** The caller's session hash, or null when they have no (valid) session cookie. Read-only: safe in Server Components. */
export async function getSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SCAN_SESSION_COOKIE)?.value;
  return token && TOKEN_SHAPE.test(token) ? hashSessionToken(token) : null;
}

/** Returns the caller's session hash, creating the cookie if needed. Only callable where cookies may be set (route handlers, actions). */
export async function ensureSessionHash(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SCAN_SESSION_COOKIE)?.value;
  if (existing && TOKEN_SHAPE.test(existing)) return hashSessionToken(existing);

  const token = newSessionToken();
  jar.set(SCAN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SCAN_SESSION_MAX_AGE_SECONDS,
  });
  return hashSessionToken(token);
}
