import type { ConnectionState, MonitoringState } from "@/lib/agents/connection-state";

/**
 * The eight phases the connect experience speaks in. They are a PRESENTATION of the backend's evidence-based
 * state (lib/agents/connection-state.ts), never a second source of truth and never a timer:
 *
 *   IDLE            nothing has been created yet (no agent, so nothing to ask the backend about)
 *   CONNECTING      the agent exists and a credential was issued; nothing has authenticated with it yet
 *   AUTHENTICATING  identity is verified, but no connection is established yet
 *   VERIFYING       connection established, waiting for the first reported activity
 *   CONNECTED       the agent's own credential reached Aegis (see `monitoring` for whether activity is arriving)
 *   FAILED          the backend knows the connection is unusable (expired credential, failed check, ...)
 *   DISCONNECTED    the connection was disconnected / its credential revoked
 *   RECONNECTING    it has connected before and is waiting for a request with the new credential
 *
 * Pure (no database, no React) so every mapping is unit-tested.
 */
export type ConnectionPhase = "IDLE" | "CONNECTING" | "AUTHENTICATING" | "VERIFYING" | "CONNECTED" | "FAILED" | "DISCONNECTED" | "RECONNECTING";

export type PhaseEvidence = {
  state: ConnectionState;
  monitoring: MonitoringState;
  firstHandshakeAt: string | Date | null;
  steps: { key: "identity" | "connection" | "activity"; done: boolean }[];
};

export const PHASE_LABEL: Record<ConnectionPhase, string> = {
  IDLE: "Idle",
  CONNECTING: "Connecting",
  AUTHENTICATING: "Authenticating",
  VERIFYING: "Verifying",
  CONNECTED: "Connected",
  FAILED: "Connection failed",
  DISCONNECTED: "Disconnected",
  RECONNECTING: "Reconnecting",
};

export function connectionPhase(evidence: PhaseEvidence | null): ConnectionPhase {
  if (!evidence) return "IDLE";
  const done = (key: "identity" | "connection" | "activity") => evidence.steps.some((s) => s.key === key && s.done);

  switch (evidence.state) {
    case "ERROR":
      return "FAILED";
    case "REVOKED":
      return "DISCONNECTED";
    case "WAITING":
      // A fresh credential on an agent that has connected before: it is coming back, not arriving for the first time.
      return evidence.firstHandshakeAt ? "RECONNECTING" : "CONNECTING";
    case "CREDENTIAL_VERIFIED":
      return done("identity") ? "AUTHENTICATING" : "CONNECTING";
    case "NOT_SEEN_RECENTLY":
      // It connected, then went quiet. That is not a failure and not a disconnection.
      return "CONNECTED";
    case "CONNECTED":
      // Connected, but Aegis has not yet received any activity from it.
      return evidence.monitoring === "NONE" && !done("activity") ? "VERIFYING" : "CONNECTED";
  }
}

export type StageStatus = "done" | "current" | "pending" | "failed";
export type Stage = { key: string; label: string; status: StageStatus };

/**
 * The four stages shown while connecting. Each is "done" only because its evidence exists; the first one the
 * backend has not confirmed is "current" (or "failed" when the backend reports the connection is unusable).
 */
export function connectionStages(evidence: PhaseEvidence | null): Stage[] {
  const done = (key: "identity" | "connection" | "activity") => Boolean(evidence?.steps.some((s) => s.key === key && s.done));
  const base: { key: string; label: string; done: boolean }[] = [
    { key: "identity", label: "Identity verification", done: done("identity") },
    { key: "channel", label: "Secure channel", done: done("connection") },
    { key: "handshake", label: "Agent handshake", done: evidence?.state === "CONNECTED" || evidence?.state === "NOT_SEEN_RECENTLY" },
    { key: "monitoring", label: "Monitoring initialization", done: evidence?.monitoring === "RECEIVING" || evidence?.monitoring === "QUIET" || done("activity") },
  ];
  const failing = evidence?.state === "ERROR" || evidence?.state === "REVOKED";
  let currentAssigned = false;
  return base.map((s) => {
    if (s.done) return { key: s.key, label: s.label, status: "done" as const };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key: s.key, label: s.label, status: failing ? ("failed" as const) : ("current" as const) };
    }
    return { key: s.key, label: s.label, status: "pending" as const };
  });
}
