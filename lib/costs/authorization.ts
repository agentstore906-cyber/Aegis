import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** OWNER, ADMIN, ENGINEER, SECURITY, FINANCE, and VIEWER can all view cost data — see lib/rbac/capabilities.ts. */
export function canViewCosts(role: MemberRole): boolean {
  return hasCapability(role, "view_costs");
}

/** Only OWNER, ADMIN, and FINANCE can create/edit/delete budgets. */
export function canManageBudgets(role: MemberRole): boolean {
  return hasCapability(role, "manage_budgets");
}
