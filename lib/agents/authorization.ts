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

/**
 * Separation of duties for the kill switch. STOPPED is the stronger operator
 * signal ("shut this down", unlike the temporary PAUSED — see the AgentStatus
 * enum). Anyone who can manage agents may PAUSE, RESUME a paused agent, or
 * STOP; but moving an agent OUT of STOPPED needs `resolve_security`
 * (OWNER / ADMIN / SECURITY). Otherwise an engineer could silently undo a
 * security responder's stop in the middle of an incident.
 */
export function canResumeStoppedAgent(role: MemberRole): boolean {
  return hasCapability(role, "resolve_security");
}
