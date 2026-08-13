import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * Centralized role checks for the policy engine. Server Actions and page
 * loaders call these directly — never infer authorization from whether a
 * button happens to be rendered.
 *
 * Delegates to lib/rbac/capabilities.ts's central role -> capability map
 * (see docs/rbac.md) rather than comparing roles here — this file exists
 * so call sites keep their existing, domain-specific names.
 */

export function canManagePolicies(role: MemberRole): boolean {
  return hasCapability(role, "manage_policies");
}

export function canManageAgentPermissions(role: MemberRole): boolean {
  return hasCapability(role, "manage_permissions");
}

/** Every role, including VIEWER, can read policies, permissions, and evaluation history. */
export function canViewPolicyEvaluations(): boolean {
  return true;
}
