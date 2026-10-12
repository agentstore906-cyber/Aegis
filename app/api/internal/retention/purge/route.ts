import { rejectUnauthorizedCron } from "@/lib/server/cron-auth";
import { purgeExpiredActivity } from "@/lib/retention/activity";
import { resolvePurgeMode } from "@/lib/retention/mode";

/** Vercel cron functions get the route's own limit; the purge budget stays well inside it. */
export const maxDuration = 60;

/**
 * GET /api/internal/retention/purge — plan-based activity retention.
 *
 * SAFE BY DEFAULT: with no parameters this is a DRY RUN that counts what would be deleted and deletes nothing.
 * Deleting needs `?mode=delete` AND `AEGIS_RETENTION_PURGE_ENABLED=true` in the deployment (lib/retention/mode.ts).
 * Internal only: requires `Authorization: Bearer $CRON_SECRET` (checked first) and fails closed with 503 when
 * CRON_SECRET isn't configured. Cross-tenant by design (every organization's plan window); returns counts only.
 *
 * Organizations are isolated from one another: one that fails is recorded in `failures` (id + error class/code, no
 * messages or data) and the rest still run. Any failure makes the response 500 so the cron shows as failed, while the
 * body still reports exactly what was processed and deleted.
 */
export async function GET(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const mode = resolvePurgeMode(new URL(request.url), process.env);
  if (mode.kind === "refused") {
    console.warn(JSON.stringify({ msg: "activity_retention_purge_refused", status: mode.status }));
    return Response.json({ error: { code: "MODE_REFUSED", message: mode.message } }, { status: mode.status });
  }

  const result = await purgeExpiredActivity({ budgetMs: 40_000, dryRun: mode.kind === "dry_run" });
  console.info(JSON.stringify({ msg: "activity_retention_purge", mode: mode.kind, ...result }));
  return Response.json({ mode: mode.kind, ...result }, { status: result.organizationsFailed > 0 ? 500 : 200 });
}
