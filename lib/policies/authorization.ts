import type { MemberRole } from "@prisma/client";

/**
 * Centralized role checks for the policy engine. Server Actions and page
 * loaders call these directly — never infer authorization from whether a
 * button happens to be rendered.
 *
 * Policies are org-wide guardrails, so only OWNER/ADMIN/SECURITY can author
 * them. Agent permissions are more operational (per-agent baseline access),
 * so ENGINEER can manage those too. Everyone with organization access,
 * including VIEWER, can read policies, permissions, and evaluation history.
 */

export function canManagePolicies(role: MemberRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SECURITY";
}

export function canManageAgentPermissions(role: MemberRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "SECURITY" || role === "ENGINEER";
}

/** Every role, including VIEWER, can read policies, permissions, and evaluation history. */
export function canViewPolicyEvaluations(): boolean {
  return true;
}
