import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Anyone who can see costs can see billing status — it's the same class of financial data. */
export function canViewBilling(role: MemberRole): boolean {
  return hasCapability(role, "view_billing") || hasCapability(role, "manage_billing");
}

/** Checkout, plan changes, and the Stripe portal are OWNER/ADMIN only — same sensitivity class as API keys and webhooks. */
export function canManageBilling(role: MemberRole): boolean {
  return hasCapability(role, "manage_billing");
}
