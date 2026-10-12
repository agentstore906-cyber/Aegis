import { timingSafeEqual } from "node:crypto";

/** Constant-time check of `Authorization: Bearer <secret>` (what Vercel Cron sends when CRON_SECRET is set). */
export function isAuthorizedCron(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Shared gate for internal cron routes: null = proceed, otherwise the response to return. Fails closed when CRON_SECRET is unset. */
export function rejectUnauthorizedCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });
  }
  return null;
}
