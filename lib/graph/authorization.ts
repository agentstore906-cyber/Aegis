import type { MemberRole } from "@prisma/client";

import { canViewSecurityAlerts } from "@/lib/security/authorization";

/**
 * The action graph shows decisions, policies, approvals, risk and trust for
 * an agent's activity, so it has the same visibility as the other security
 * views (security alerts, behavior, trust, risk control): every role that
 * holds `view_security` — not FINANCE. Pages enforce this server-side; the
 * public API enforces the `graph:read` key scope instead.
 */
export function canViewActionGraph(role: MemberRole): boolean {
  return canViewSecurityAlerts(role);
}
