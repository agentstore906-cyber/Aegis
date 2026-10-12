/**
 * Which mode a retention request runs in. Destructive mode is opt-in on TWO independent levers, so no URL on its own
 * (a typo, a copied link, a cron path edited carelessly) can delete anything:
 *   1. the request must say `?mode=delete`, AND
 *   2. the deployment must carry `AEGIS_RETENTION_PURGE_ENABLED=true`.
 * Everything else — no parameter, `mode=dry-run`, the legacy `dryRun=1`, and even `dryRun=0` / `dryRun=false` — is a
 * dry run that deletes nothing. A `mode` value we do not recognize is refused rather than guessed at.
 * (Authentication is checked before this is ever consulted; see lib/server/cron-auth.ts.)
 */
export type PurgeMode =
  | { kind: "dry_run" }
  | { kind: "delete" }
  | { kind: "refused"; status: 400 | 409; message: string };

export function resolvePurgeMode(url: URL, env: Record<string, string | undefined>): PurgeMode {
  const mode = url.searchParams.get("mode");
  if (mode === null || mode === "" || mode === "dry-run" || mode === "dry_run") return { kind: "dry_run" };
  if (mode === "delete") {
    if (env.AEGIS_RETENTION_PURGE_ENABLED === "true") return { kind: "delete" };
    return { kind: "refused", status: 409, message: "Delete mode is not enabled in this deployment (AEGIS_RETENTION_PURGE_ENABLED is not \"true\"). Nothing was deleted." };
  }
  return { kind: "refused", status: 400, message: 'Unknown mode. Use "dry-run" (the default) or "delete". Nothing was deleted.' };
}
