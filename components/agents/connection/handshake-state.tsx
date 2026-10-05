import { CheckCircle2, Circle } from "lucide-react";

import type { ConnectionSnapshotJson, StatusProblem } from "./use-connection-status";

const PROBLEM_TEXT: Record<StatusProblem, string> = {
  "signed-out": "Your session has ended. Sign in again to keep checking.",
  "not-found": "This agent could not be found in your organization.",
  unavailable: "Aegis could not read the connection status just now. It will try again.",
  unreachable: "Could not reach Aegis from this browser. Check your connection; it will try again.",
};

/**
 * The connection indicator. Every state here is the backend's word, not an animation:
 *   ○ Waiting for handshake   no request with this agent's credential has reached Aegis
 *   ✓ Connected               one has (the parent then swaps to the detected screen)
 * The "last checked" time is when a status check last SUCCEEDED. A failed check is shown as a failed check,
 * never as silence and never as progress.
 */
export function HandshakeState({ snapshot, problem, checkedAt }: { snapshot: ConnectionSnapshotJson | null; problem: StatusProblem | null; checkedAt: Date | null }) {
  const connected = snapshot?.view.state === "CONNECTED";
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3.5">
      {connected ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="section-label">{connected ? "Connected" : "Waiting for your agent…"}</p>
        <p className="mt-1 text-sm text-foreground">{connected ? "Your agent has made contact." : "Run your agent once to establish the connection."}</p>
        <p className="num mt-1 text-xs text-muted-foreground">
          {problem ? (
            <span className="text-warning">{PROBLEM_TEXT[problem]}</span>
          ) : checkedAt ? (
            <>Aegis last checked at {checkedAt.toLocaleTimeString([], { hour12: false })}. {connected ? "" : "Nothing has been received yet."}</>
          ) : (
            "Checking…"
          )}
        </p>
      </div>
    </div>
  );
}
