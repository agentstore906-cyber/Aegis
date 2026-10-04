import { timingSafeEqual } from "node:crypto";

import { refreshStaleBaselines } from "@/lib/behavior/refresh";
import { refreshTrust } from "@/lib/trust/refresh";

/** Vercel cron functions get the route's own limit; keep the work well inside it. */
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * GET /api/internal/behavior/refresh — scheduled baseline and trust maintenance
 * (vercel.json cron, daily). Internal only: requires
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this automatically
 * when CRON_SECRET is set) and fails closed with 503 when CRON_SECRET isn't
 * configured. Cross-tenant by design (it maintains every organization's
 * agents) and returns only counts — never behavioral data.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });
  }
  // Baselines first (trust reads the baseline's maturity), within one shared time budget.
  const result = await refreshStaleBaselines({ budgetMs: 30_000, limit: 500 });
  const trust = await refreshTrust({ budgetMs: 12_000, limit: 500 });
  return Response.json({ ...result, trust });
}
