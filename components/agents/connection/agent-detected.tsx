import { CheckCircle2 } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

import { AgentProtectionStatus } from "./agent-protection-status";
import type { ConnectionSnapshotJson } from "./use-connection-status";

const ENVIRONMENT: Record<string, string> = { PRODUCTION: "Production", STAGING: "Staging", DEVELOPMENT: "Development" };

/**
 * Shown only after the backend reports a connection. Each check is listed because its evidence exists —
 * a step without evidence is not shown as done, and the first-activity line appears only once an event has arrived.
 */
export function AgentDetected({ snapshot }: { snapshot: ConnectionSnapshotJson }) {
  const done = snapshot.view.steps.filter((s) => s.done);
  const awaitingActivity = !snapshot.view.steps.find((s) => s.key === "activity")?.done;
  return (
    <div className="aegis-enter">
      <p className="section-label">Agent detected</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{snapshot.agent.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{ENVIRONMENT[snapshot.agent.environment] ?? snapshot.agent.environment}</p>

      <ul className="mt-6 space-y-2" aria-label="Verified checks">
        {done.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5 text-sm text-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            {step.label}
            {step.at && <span className="num text-xs text-muted-foreground">{new Date(step.at).toLocaleTimeString([], { hour12: false })}</span>}
          </li>
        ))}
      </ul>
      {awaitingActivity && <p className="mt-3 text-xs text-muted-foreground">Aegis starts monitoring as soon as the agent reports its first event.</p>}

      <AgentProtectionStatus view={snapshot.view} className="mt-6" />

      <div className="mt-6">
        <ButtonLink href={`/agents/${snapshot.agent.slug}`}>Enter Aegis</ButtonLink>
      </div>
    </div>
  );
}
