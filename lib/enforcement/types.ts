/**
 * Aegis's honesty boundary. Everywhere Aegis records a decision or a desired
 * control state (agent pause/stop, policy BLOCK, a firewall decision), it
 * must also be able to say whether it actually has a technical mechanism to
 * make that decision real on the external agent — or whether it only
 * recorded the decision/intent. Never let a UI or API response imply the
 * stronger claim when only the weaker one is true.
 *
 * See docs/enforcement.md.
 */

/** The outcome of asking a connector to do something to an external agent. */
export type EnforcementOutcome = {
  /** True only when the connector has real evidence the external agent was actually affected. */
  enforced: boolean;
  /** Which connector produced this outcome, e.g. "null", "webhook-ack" — null if none is configured. */
  mechanism: string | null;
  /** Always-truthful, user-facing sentence explaining what did or didn't happen. */
  detail: string;
};

export type AgentControlAction = "pause" | "resume" | "stop";

/**
 * Extension point for a future integration that can actually affect a
 * connected agent (e.g. an SDK that polls its control state and self-halts,
 * or a gateway that can reject the agent's own outbound calls). Today only
 * `NullEnforcementConnector` (lib/enforcement/null-connector.ts) exists —
 * every method truthfully reports `enforced: false`.
 */
export interface EnforcementConnector {
  readonly kind: string;
  control(agentId: string, action: AgentControlAction): Promise<EnforcementOutcome>;
}
