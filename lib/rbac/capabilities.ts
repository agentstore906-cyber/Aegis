import type { MemberRole } from "@prisma/client";

/**
 * The single source of truth for "what can this role do." Every domain's
 * authorization file (lib/policies/authorization.ts,
 * lib/approvals/authorization.ts, lib/api-keys/authorization.ts, and the
 * Phase 5 additions in lib/security/, lib/costs/, lib/webhooks/,
 * lib/organizations/) delegates to hasCapability() rather than comparing
 * roles itself — see docs/rbac.md.
 *
 * Deliberately does NOT cover plain "view" access to Approvals or Policy
 * Evaluations — those have been unconditionally available to every
 * organization member (including VIEWER) since Phase 2/3
 * (canViewApprovals / canViewPolicyEvaluations), and that stays true here
 * unchanged. This map covers the capabilities that actually differ by
 * role: mutations, resolutions, and the Phase 5 view surfaces that are
 * new enough to be worth naming explicitly.
 */
export const CAPABILITIES = [
  "manage_agents",
  "manage_policies",
  "manage_permissions",
  "resolve_approvals",
  "view_security",
  "resolve_security",
  "view_costs",
  "manage_api_keys",
  "view_audit",
  "manage_members",
  "manage_webhooks",
  "view_billing",
  "manage_billing",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL_CAPABILITIES = [...CAPABILITIES];

const ROLE_CAPABILITIES: Record<MemberRole, Capability[]> = {
  OWNER: ALL_CAPABILITIES,
  ADMIN: ALL_CAPABILITIES,
  ENGINEER: ["manage_agents", "manage_permissions", "view_security", "view_costs", "view_audit"],
  SECURITY: [
    "manage_agents", // needed so "Pause agent" from a security alert actually works (spec §15)
    "manage_policies",
    "manage_permissions",
    "resolve_approvals",
    "view_security",
    "resolve_security",
    "view_audit",
  ],
  // FINANCE can see billing status (it's financial data, like costs) but
  // cannot check out, change plans, or open the Stripe portal — only
  // OWNER/ADMIN hold manage_billing, matching "Engineer cannot modify
  // billing" / "only appropriate roles can access billing."
  FINANCE: ["view_costs", "view_audit", "view_billing"],
  VIEWER: ["view_security", "view_costs", "view_audit"],
};

export function hasCapability(role: MemberRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** All capabilities granted to a role — used by tests and any future "what can I do" UI. */
export function capabilitiesFor(role: MemberRole): Capability[] {
  return ROLE_CAPABILITIES[role];
}
