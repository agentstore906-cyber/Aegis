import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/** Every role can view security alerts — VIEWER included, same convention as Approvals/Audit. */
export function canViewSecurityAlerts(role: MemberRole): boolean {
  return hasCapability(role, "view_security");
}

/** Acknowledge/resolve a security alert. Narrower — see lib/rbac/capabilities.ts. */
export function canResolveSecurityAlerts(role: MemberRole): boolean {
  return hasCapability(role, "resolve_security");
}
