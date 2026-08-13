import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Invite, change role, remove members, and edit org settings — OWNER/ADMIN only. Escalation to/from OWNER has an additional check — see lib/organizations/members.ts. */
export function canManageMembers(role: MemberRole): boolean {
  return hasCapability(role, "manage_members");
}
