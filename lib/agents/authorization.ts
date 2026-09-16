import type { MemberRole } from "@prisma/client";
import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * Create/edit/pause/resume/stop an agent (the kill switch — see
 * lib/agents/control.ts and docs/enforcement.md). Broader than most
 * "manage_*" capabilities — SECURITY needs it too, so "Pause agent" from a
 * security alert (docs/security-intelligence.md) actually works, not just
 * a button that looks functional. See lib/rbac/capabilities.ts.
 */
export function canManageAgents(role: MemberRole): boolean {
  return hasCapability(role, "manage_agents");
}
