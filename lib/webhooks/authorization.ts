import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Webhook secrets can trigger outbound calls carrying organization data — OWNER/ADMIN only, same sensitivity class as API keys. */
export function canManageWebhooks(role: MemberRole): boolean {
  return hasCapability(role, "manage_webhooks");
}
