import "server-only";

import { env } from "@/lib/env";

/**
 * Internal-only, platform-wide admin — distinct from `MemberRole` (which is
 * always scoped to one Organization). Backed by an env allowlist rather than
 * a DB flag: nobody can grant themselves admin by writing a row, and there's
 * no UI path that could accidentally expose it. See docs/sales/ and
 * app/admin/layout.tsx, which gates every /admin/* route through this
 * single check (leads, feedback triage, platform metrics).
 */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
