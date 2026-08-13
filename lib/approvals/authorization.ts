import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * Centralized role checks for the approval workflow. Server Actions and
 * page loaders call these directly — never infer authorization from
 * whether the Approve/Reject buttons happen to be rendered.
 *
 * Delegates to lib/rbac/capabilities.ts's central role -> capability map
 * (see docs/rbac.md). Everyone with organization access, including
 * VIEWER, can read approval requests and their history — that predates
 * the capability system and stays a plain unconditional read, not a
 * capability.
 */

export function canResolveApproval(role: MemberRole): boolean {
  return hasCapability(role, "resolve_approvals");
}

export function canViewApprovals(): boolean {
  return true;
}
