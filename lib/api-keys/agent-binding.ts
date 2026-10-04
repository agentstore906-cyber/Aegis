/**
 * Agent-level authorization for API keys (P0 — docs/AEGIS_P0_IMPLEMENTATION.md §7).
 *
 * The organization always comes from the authenticated key, never the
 * caller. On top of that, a key can be *bound* to one agent
 * (ApiKey.agentId): it may then only act as that agent — send its events,
 * evaluate its actions, read its approvals — and may not register other
 * agents. An unbound key is organization-wide by explicit choice at
 * creation time ("All agents").
 *
 * The agent a request names (`agent` slug in the body) is only a *claim*;
 * these checks are what make it an authorized identity. Pure functions so
 * every rule is unit-tested without a database.
 */

export type KeyBinding = { agentId: string | null; organizationId: string };
export type AgentRef = { id: string; organizationId: string };

/** May this key act as this agent? */
export function apiKeyMayActAsAgent(key: KeyBinding, agent: AgentRef): boolean {
  if (agent.organizationId !== key.organizationId) return false;
  if (key.agentId === null) return true;
  return key.agentId === agent.id;
}

/** May this key create (register) brand-new agents? Only organization-wide keys may. */
export function apiKeyMayRegisterAgents(key: KeyBinding): boolean {
  return key.agentId === null;
}
