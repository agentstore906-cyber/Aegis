import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Teams are an org-structure concept managed from Settings, so this reuses manage_members rather than manage_agents. */
export function canManageTeams(role: MemberRole): boolean {
  return hasCapability(role, "manage_members");
}
