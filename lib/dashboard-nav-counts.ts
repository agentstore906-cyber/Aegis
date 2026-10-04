import "server-only";

import type { MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasCapability } from "@/lib/rbac/capabilities";

export type NavCounts = Partial<Record<"pendingApprovals" | "openIncidents" | "openAlerts", number>>;

/**
 * Real counts for the navigation: pending approvals, open incidents, and open
 * high/critical security alerts. Each is a single indexed COUNT scoped to the
 * organization, and security counts are only queried for roles that may see them.
 *
 * If a count cannot be read the key is simply absent: the nav then shows NO badge
 * for it. It never shows a stale or zero value it does not know.
 */
export async function getNavCounts(organizationId: string, role: MemberRole): Promise<NavCounts> {
  const canSecurity = hasCapability(role, "view_security");
  const counts: NavCounts = {};
  const now = new Date();

  await Promise.all([
    prisma.approvalRequest
      .count({ where: { organizationId, status: "PENDING", expiresAt: { gt: now } } })
      .then((n) => void (counts.pendingApprovals = n))
      .catch(() => undefined),
    canSecurity
      ? prisma.incident
          .count({ where: { organizationId, status: { in: ["OPEN", "INVESTIGATING"] } } })
          .then((n) => void (counts.openIncidents = n))
          .catch(() => undefined)
      : undefined,
    canSecurity
      ? prisma.securityAlert
          .count({ where: { organizationId, status: "OPEN", severity: { in: ["HIGH", "CRITICAL"] } } })
          .then((n) => void (counts.openAlerts = n))
          .catch(() => undefined)
      : undefined,
  ]);

  return counts;
}
