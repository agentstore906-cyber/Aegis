/**
 * API key scopes.
 *
 * DEFAULT scopes are what every newly created key carries (mirrors the
 * database default on ApiKey.scopes — a test keeps the two identical). They
 * are the agent-facing surface: send events, ask for decisions, read approval
 * status, and read an agent's own behavior, trust and action graph.
 *
 * ADMIN scopes are OPT-IN, only for organization-wide keys used by tooling
 * (CI policy tests, governance reporting) — never by agents:
 *   policy:simulate  POST /api/v1/simulate. Its output explains detection logic (risk signals,
 *                    behavioral deviations, trust), which an agent must not be able to probe.
 *   agents:read      GET /api/v1/agents — the organization-wide inventory (every agent's access,
 *                    trust, risk and incidents).
 * A key bound to one agent can never hold them: the repository refuses at creation, and
 * both routes refuse bound keys at request time.
 */
export const DEFAULT_API_KEY_SCOPES = ["events:write", "policy:evaluate", "approvals:read", "behavior:read", "trust:read", "graph:read"] as const;

export const ADMIN_API_KEY_SCOPES = ["policy:simulate", "agents:read"] as const;

export function scopesForNewKey(options: { adminAccess: boolean }): string[] {
  return options.adminAccess ? [...DEFAULT_API_KEY_SCOPES, ...ADMIN_API_KEY_SCOPES] : [...DEFAULT_API_KEY_SCOPES];
}

export class AdminScopeOnBoundKeyError extends Error {
  constructor() {
    super("Admin access (simulation and inventory) can only be granted to an organization-wide key, never to a key bound to one agent.");
    this.name = "AdminScopeOnBoundKeyError";
  }
}
