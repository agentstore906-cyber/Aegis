import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Anyone who can see costs can see billing status — it's the same class of financial data. */
export function canViewBilling(role: MemberRole): boolean {
  return hasCapability(role, "view_billing") || hasCapability(role, "manage_billing");
}

/**
 * Who can open /upgrade — and therefore the only roles an "Upgrade" link may be shown to. The page and every link to
 * it use this one rule, so a link can never lead a user to a 404. Opening /upgrade grants no billing power: checkout and
 * plan changes still need `canManageBilling` (OWNER/ADMIN) and are enforced server-side.
 */
export function canAccessUpgradePage(role: MemberRole): boolean {
  return canViewBilling(role);
}

/** Checkout, plan changes, and the Paddle customer portal are OWNER/ADMIN only — same sensitivity class as API keys and webhooks. */
export function canManageBilling(role: MemberRole): boolean {
  return hasCapability(role, "manage_billing");
}
