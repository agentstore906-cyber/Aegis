import { CheckCircle2, Info } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

import type { ConnectionSnapshotJson } from "./use-connection-status";

/** "just now" / "2 minutes ago" — from the backend's own timestamp, never a guess. */
export function connectedAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Connected";
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Connected just now";
  if (minutes === 1) return "Connected 1 minute ago";
  if (minutes < 60) return `Connected ${minutes} minutes ago`;
  return "Connected";
}

/**
 * Shown only after the backend reports a connection. Every line is true because its evidence exists:
 *   - "Monitoring is active" only once an event has really arrived (a handshake alone proves contact, not monitoring);
 *   - the policy note only when nothing would allow the agent's actions (Aegis denies by default), so a connected agent
 *     that is about to be refused does not look like a failed connection.
 * It never says "protected": Aegis returns decisions for the actions an agent asks about; it cannot stop an agent that doesn't ask.
 */
export function AgentDetected({ snapshot }: { snapshot: ConnectionSnapshotJson }) {
  const monitoring = snapshot.view.reportedEventCount > 0;
  const asksForDecisions = snapshot.view.protection === "ASKS_FOR_DECISIONS";
  return (
    <div className="aegis-enter">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Agent connected</h2>
      </div>
      <p className="mt-3 text-lg font-medium text-foreground">{snapshot.agent.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{connectedAgo(snapshot.view.firstHandshakeAt ?? snapshot.view.lastSeenAt)}</p>

      <ul className="mt-5 space-y-1.5 text-sm text-foreground">
        <li>{monitoring ? "Monitoring is active." : "Monitoring starts when your agent reports its first event."}</li>
        {asksForDecisions && <li>Asks Aegis for decisions. Policies are evaluated for the actions it asks about.</li>}
      </ul>

      {!snapshot.hasAllowRule && (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3.5" role="note">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">No policy currently allows this agent&rsquo;s actions.</p>
            <p className="mt-1 text-muted-foreground">Your agent is connected. Aegis denies actions by default, so add a policy for what it may do.</p>
            <div className="mt-3">
              <ButtonLink href={`/agents/${snapshot.agent.slug}?tab=permissions`} variant="secondary" size="sm">
                Configure policies
              </ButtonLink>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <ButtonLink href={`/agents/${snapshot.agent.slug}`}>View agent</ButtonLink>
      </div>
    </div>
  );
}
