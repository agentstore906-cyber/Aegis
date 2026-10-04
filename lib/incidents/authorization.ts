import type { MemberRole } from "@prisma/client";

import { hasCapability } from "@/lib/rbac/capabilities";

/**
 * Incidents are security data: viewing needs `view_security` (every role except
 * FINANCE, like alerts, behavior, trust, the action graph and risk control).
 * Handling an incident — acknowledging it, changing its status, adding notes,
 * opening one by hand — needs `resolve_security`, the same capability that
 * resolves security alerts. Neither can change or remove the evidence an
 * incident describes.
 */
export function canViewIncidents(role: MemberRole): boolean {
  return hasCapability(role, "view_security");
}

export function canManageIncidents(role: MemberRole): boolean {
  return hasCapability(role, "resolve_security");
}

export type IncidentActor = { organizationId: string; userId: string; role: MemberRole };

export class IncidentForbiddenError extends Error {
  constructor(message = "You do not have permission to do that with incidents.") {
    super(message);
    this.name = "IncidentForbiddenError";
  }
}
export class IncidentNotFoundError extends Error {
  constructor() {
    super("Incident not found.");
    this.name = "IncidentNotFoundError";
  }
}
export class IncidentTransitionError extends Error {
  constructor(
    public readonly code: "NO_CHANGE" | "NOT_ALLOWED" | "NOTE_REQUIRED" | "NOTE_TOO_LONG" | "CONFLICT" | "EMPTY_NOTE",
    message: string
  ) {
    super(message);
    this.name = "IncidentTransitionError";
  }
}

export function assertCanView(actor: IncidentActor) {
  if (!canViewIncidents(actor.role)) throw new IncidentForbiddenError("Incidents are not available to your role.");
}
export function assertCanManage(actor: IncidentActor) {
  if (!canManageIncidents(actor.role)) throw new IncidentForbiddenError("Your role can view incidents but not change them.");
}
