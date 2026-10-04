import {
  AGENT_TYPE_PROFILE,
  AUTONOMY_RANK,
  CAPABILITY_BY_ID,
  LIMITS,
  type AgentTypeId,
  type AutonomyId,
  type CapabilityId,
  type ControlId,
  type ControlState,
} from "@/lib/scanner/catalog";

/**
 * Pure state logic for the scanner wizard, kept apart from React so progression, adaptation and the
 * request payload are unit-testable. The server re-validates everything (lib/scanner/validation.ts);
 * nothing here is a security boundary.
 */

export const STEPS = ["type", "capabilities", "autonomy", "controls", "advanced"] as const;
export type StepId = (typeof STEPS)[number];

export type Draft = {
  agentType: AgentTypeId | null;
  agentLabel: string;
  capabilities: CapabilityId[];
  autonomy: AutonomyId[];
  controls: Partial<Record<ControlId, ControlState>>;
  advancedText: string;
};

export const emptyDraft = (): Draft => ({ agentType: null, agentLabel: "", capabilities: [], autonomy: [], controls: {}, advancedText: "" });

/** Why a step can't be left yet, or null when it can. Capabilities may legitimately be empty ("nothing selected"). */
export function stepProblem(step: StepId, draft: Draft): string | null {
  switch (step) {
    case "type":
      if (!draft.agentType) return "Choose the kind of agent you’re securing.";
      if (draft.agentType === "other" && draft.agentLabel.trim().length < 2) return "Add a few words describing your agent.";
      return null;
    case "autonomy":
      return draft.autonomy.length === 0 ? "Choose what your agent can do without approval." : null;
    case "advanced":
      return draft.advancedText.length > LIMITS.maxAdvancedChars ? `Pasted content must be ${LIMITS.maxAdvancedChars.toLocaleString("en-US")} characters or fewer.` : null;
    default:
      return null;
  }
}

/** Toggle with the one mutual-exclusion rule: "Read only" excludes every other level, and vice versa. */
export function toggleAutonomy(current: AutonomyId[], id: AutonomyId): AutonomyId[] {
  if (current.includes(id)) return current.filter((a) => a !== id);
  if (id === "read_only") return ["read_only"];
  return [...current.filter((a) => a !== "read_only"), id];
}

export const toggleIn = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function suggestedCapabilities(agentType: AgentTypeId | null): CapabilityId[] {
  return agentType ? AGENT_TYPE_PROFILE[agentType].suggested : [];
}

const hasAny = (caps: CapabilityId[], ids: CapabilityId[]) => ids.some((id) => caps.includes(id));

/** Which security-control questions matter most for what the user has described. Used to order and flag, never to hide. */
export function relevantControls(draft: Pick<Draft, "capabilities" | "autonomy">): ControlId[] {
  const caps = draft.capabilities;
  const rank = draft.autonomy.length === 0 ? 0 : Math.max(...draft.autonomy.map((a) => AUTONOMY_RANK[a]));
  const actions = caps.filter((id) => CAPABILITY_BY_ID[id].group === "actions");
  const out = new Set<ControlId>();
  if (caps.length > 0) out.add("tool_permissions");
  if (actions.length > 0 || hasAny(caps, ["code_execution", "shell"])) out.add("approval_gates").add("human_in_loop").add("policy_enforcement");
  if (hasAny(caps, ["code_execution", "shell"])) out.add("sandboxing");
  if (hasAny(caps, ["credentials_secrets", "cloud_services", "apis", "shell", "code_execution"])) out.add("secrets_isolation");
  if (hasAny(caps, ["web_browsing", "send_emails", "apis", "code_execution", "shell", "cloud_services"])) out.add("network_restrictions");
  if (actions.length > 0 && rank >= 3) out.add("rate_limits");
  if (caps.length > 0 || rank > 0) out.add("audit_logs").add("action_monitoring");
  return [...out];
}

/** The request body for POST /api/scan. Omits empty optional fields. */
export function toRequestBody(draft: Draft) {
  return {
    agentType: draft.agentType,
    agentLabel: draft.agentType === "other" && draft.agentLabel.trim() ? draft.agentLabel.trim() : null,
    capabilities: draft.capabilities,
    autonomy: draft.autonomy,
    controls: draft.controls,
    advancedText: draft.advancedText.trim() ? draft.advancedText : null,
  };
}

/** Which step owns an API field error, so a 422 can send the user straight to the problem. */
export function stepForField(field: string): StepId {
  if (field === "agentType" || field === "agentLabel") return "type";
  if (field === "capabilities") return "capabilities";
  if (field === "autonomy") return "autonomy";
  if (field === "controls") return "controls";
  return "advanced";
}

/** What may be persisted in sessionStorage so a refresh doesn't lose progress. Pasted text is never included. */
export function draftForStorage(draft: Draft, step: number) {
  return { v: 1, step, agentType: draft.agentType, agentLabel: draft.agentLabel, capabilities: draft.capabilities, autonomy: draft.autonomy, controls: draft.controls };
}
