import type { EventView } from "@/lib/graph/types";

export type ChainStep = { kind: "USER" | "AGENT" | "TASK" | "TOOL" | "API" | "DATA" | "ACTION" | "RESULT"; label: string };

/**
 * The USER → AGENT → TASK → TOOL → API → DATA → ACTION → RESULT chain for one
 * event, from the fields it actually reported. A step with nothing reported is
 * left out rather than shown as an empty placeholder.
 */
export function chainFor(event: EventView, agentName: string, traceId: string): ChainStep[] {
  const steps: ChainStep[] = [];
  if (event.endUserHash) steps.push({ kind: "USER", label: `End user ${event.endUserHash.slice(0, 8)}` });
  steps.push({ kind: "AGENT", label: agentName });
  steps.push({ kind: "TASK", label: event.taskId ? `Task ${event.taskId}` : `Run ${traceId.slice(0, 12)}` });
  if (event.toolKey) steps.push({ kind: "TOOL", label: event.toolName ?? event.toolKey });
  const api = event.destination ?? event.service;
  if (api) steps.push({ kind: "API", label: api });
  if (event.dataClasses.length > 0) steps.push({ kind: "DATA", label: event.dataClasses.join(", ") });
  steps.push({ kind: "ACTION", label: event.action });
  steps.push({
    kind: "RESULT",
    label: event.decision
      ? `Decided ${event.decision.decision}`
      : event.outcome
        ? `Reported ${event.outcome.toLowerCase()}`
        : event.status.replaceAll("_", " ").toLowerCase(),
  });
  return steps;
}
