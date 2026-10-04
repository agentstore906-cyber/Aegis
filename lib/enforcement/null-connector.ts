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
    // What Aegis itself does is real and stated precisely (P0 §1: /evaluate
    // refuses a paused/stopped agent); what it can't do — reach into the
    // external process — stays explicit, and `enforced` stays false.
    const aegisSide =
      action === "resume"
        ? "Aegis has resumed normal policy evaluation for its authorization requests."
        : "Aegis now returns BLOCK for every authorization request (POST /api/v1/evaluate) this agent makes, so an integration that checks with Aegis before acting will stop.";
    return {
      enforced: false,
      mechanism: null,
      detail: `Aegis marked this agent as ${ACTION_VERB[action]}. ${aegisSide} No enforcement connector is configured for this connection, so Aegis cannot halt the external process itself or stop actions it takes without asking — those are only detected after the fact if reported.`,
    };
  }
}
