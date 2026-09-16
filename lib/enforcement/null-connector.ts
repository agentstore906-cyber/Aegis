import type { AgentControlAction, EnforcementConnector, EnforcementOutcome } from "@/lib/enforcement/types";

const ACTION_VERB: Record<AgentControlAction, string> = {
  pause: "paused",
  resume: "resumed",
  stop: "stopped",
};

/**
 * The only connector that exists today. Aegis has no integration that can
 * actually reach into a connected agent and pause/resume/stop it — agents
 * report their own activity to Aegis, not the other way around. This
 * connector is what makes that limitation explicit and structural instead
 * of an easy-to-forget comment: every caller gets back `enforced: false`
 * and a truthful sentence, never a silent no-op.
 */
export class NullEnforcementConnector implements EnforcementConnector {
  readonly kind = "null";

  async control(_agentId: string, action: AgentControlAction): Promise<EnforcementOutcome> {
    return {
      enforced: false,
      mechanism: null,
      detail: `Aegis marked this agent as ${ACTION_VERB[action]}, but no enforcement connector is configured for this connection — Aegis cannot guarantee the external agent honors this state.`,
    };
  }
}
