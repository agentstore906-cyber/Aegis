import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * API keys are infrastructure credentials — anyone holding one can act as
 * the organization against the public API, so managing them (creating,
 * revoking) is narrower than managing policies. Everyone with organization
 * access can see that keys exist (name, prefix, last used), but only
 * OWNER/ADMIN can create or revoke one — see lib/rbac/capabilities.ts.
 */
export function canManageApiKeys(role: MemberRole): boolean {
  return hasCapability(role, "manage_api_keys");
}
