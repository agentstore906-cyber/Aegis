import type { ConnectionStatus, ConnectorType } from "@prisma/client";

/**
 * What an agent's connection to Aegis means — derived ONLY from stored evidence, never from a click.
 *
 * Three separate questions, three separate answers (they are easy to confuse and must not be):
 *
 *   CONNECTION   Has a request authenticated with this agent's own credential actually reached Aegis?
 *   MONITORING   Is Aegis receiving the agent's reported activity?
 *   PROTECTION   Is the agent asking Aegis for decisions? Aegis returns decisions; it is not in the
 *                agent's data path and cannot stop an agent that ignores them — so there is
 *                deliberately NO "Protected" state here. See docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md §4.
 *
 * Pure (no database, no React) so every rule is unit-tested.
 */

export type ConnectionState =
  /** Credential issued; nothing has contacted Aegis with it yet. */
  | "WAITING"
  /** A provider credential was verified with the provider; the agent itself has not contacted Aegis. */
  | "CREDENTIAL_VERIFIED"
  /** The agent's own credential has reached Aegis and was recently seen. */
  | "CONNECTED"
  /** Connected before, but nothing has been seen for a while. Not a claim that the agent is down. */
  | "NOT_SEEN_RECENTLY"
  /** The credential or connection is unusable and we know why (expired, failed health check, ...). */
  | "ERROR"
  /** The connection was disconnected, or its credential revoked. Nothing can authenticate with it. */
  | "REVOKED";

export type MonitoringState = "NONE" | "RECEIVING" | "QUIET";
export type ProtectionState = "MONITORING_ONLY" | "ASKS_FOR_DECISIONS";

/** No contact for this long ⇒ "not seen recently". Deliberately generous: an idle agent is not a broken one. */
export const NOT_SEEN_AFTER_MS = 24 * 60 * 60 * 1000;
/** `lastSeenAt` is written at most this often per agent, so a busy agent costs one extra write a minute. */
export const SEEN_WRITE_INTERVAL_MS = 60 * 1000;

export type ConnectionEvidence = {
  connectorType: ConnectorType;
  status: ConnectionStatus;
  disconnectedAt: Date | null;
  firstHandshakeAt: Date | null;
  lastSeenAt: Date | null;
  lastVerifiedAt: Date | null;
  lastHealthError: string | null;
  /** The connection's own Aegis API key, when it has one. */
  apiKey: { revokedAt: Date | null; expiresAt: Date | null } | null;
  /** Reported events (source "api") ever received for this agent. */
  reportedEventCount: number;
  lastReportedEventAt: Date | null;
  /** Decisions the agent asked for in the last 7 days (source "policy_evaluation"). */
  decisionRequests7d: number;
};

export type ConnectionStep = { key: "identity" | "connection" | "activity"; label: string; done: boolean; at: Date | null };

export type ConnectionView = {
  state: ConnectionState;
  stateLabel: string;
  /** One sentence saying exactly what the state means and what it does not. */
  detail: string;
  /** Why it is in ERROR / REVOKED, only when that is actually known. */
  reason: string | null;
  monitoring: MonitoringState;
  monitoringLabel: string;
  protection: ProtectionState;
  protectionLabel: string;
  protectionDetail: string;
  /** Each step is true only because the corresponding evidence exists. */
  steps: ConnectionStep[];
  firstHandshakeAt: Date | null;
  lastSeenAt: Date | null;
  reportedEventCount: number;
};

export function deriveConnectionView(e: ConnectionEvidence, now: Date = new Date()): ConnectionView {
  const usesAegisKey = e.connectorType === "CUSTOM_SDK";
  const contact = e.lastSeenAt ?? e.lastReportedEventAt;
  const hasContact = e.firstHandshakeAt !== null || e.reportedEventCount > 0;
  const keyRevoked = e.apiKey?.revokedAt != null;
  const keyExpired = e.apiKey?.expiresAt != null && e.apiKey.expiresAt <= now;

  let state: ConnectionState;
  let reason: string | null = null;

  if (e.status === "DISCONNECTED" || keyRevoked) {
    state = "REVOKED";
    reason = e.status === "DISCONNECTED" ? "This connection was disconnected." : "The credential for this connection was revoked.";
  } else if (keyExpired) {
    state = "ERROR";
    reason = "The credential for this connection has expired.";
  } else if (e.status === "FAILED" || e.status === "RECONNECT_REQUIRED" || e.status === "DEGRADED") {
    state = "ERROR";
    reason = e.lastHealthError ?? "The last connection check failed.";
  } else if (usesAegisKey) {
    if (e.status === "CONNECTING" || e.status === "VERIFYING" || !hasContact) state = "WAITING";
    else state = contact && now.getTime() - contact.getTime() > NOT_SEEN_AFTER_MS ? "NOT_SEEN_RECENTLY" : "CONNECTED";
  } else if (!hasContact) {
    state = "CREDENTIAL_VERIFIED";
  } else {
    state = contact && now.getTime() - contact.getTime() > NOT_SEEN_AFTER_MS ? "NOT_SEEN_RECENTLY" : "CONNECTED";
  }

  const copy: Record<ConnectionState, { label: string; detail: string }> = {
    WAITING: { label: "Waiting for your agent", detail: "A credential was issued. Nothing has contacted Aegis with it yet." },
    CREDENTIAL_VERIFIED: {
      label: "Credential verified",
      detail: "The provider accepted the credential. The agent itself has not contacted Aegis yet.",
    },
    CONNECTED: { label: "Connected", detail: "A request authenticated with this agent's credential has reached Aegis." },
    NOT_SEEN_RECENTLY: {
      label: "Not seen recently",
      detail: "This agent connected before, but Aegis has not heard from it for over 24 hours. It may simply be idle.",
    },
    ERROR: { label: "Connection problem", detail: "Aegis cannot rely on this connection." },
    REVOKED: { label: "Revoked", detail: "Nothing can authenticate with this connection until it is reconnected." },
  };

  // Monitoring: is reported activity arriving?
  const lastEvent = e.lastReportedEventAt;
  const monitoring: MonitoringState =
    e.reportedEventCount === 0 ? "NONE" : lastEvent && now.getTime() - lastEvent.getTime() > NOT_SEEN_AFTER_MS ? "QUIET" : "RECEIVING";
  const monitoringLabel = { NONE: "Not monitored yet", RECEIVING: "Monitored", QUIET: "Monitored · quiet" }[monitoring];

  // Protection: Aegis can only say whether the agent ASKS for decisions.
  const protection: ProtectionState = e.decisionRequests7d > 0 ? "ASKS_FOR_DECISIONS" : "MONITORING_ONLY";
  const protectionLabel = protection === "ASKS_FOR_DECISIONS" ? "Asks Aegis for decisions" : "Monitoring only";
  const protectionDetail =
    protection === "ASKS_FOR_DECISIONS"
      ? `The agent requested ${e.decisionRequests7d} decision${e.decisionRequests7d === 1 ? "" : "s"} in the last 7 days. Aegis returns decisions; the agent's integration decides whether to honor them.`
      : "Aegis sees what the agent reports and cannot stop its actions. To control actions, have the agent ask Aegis before it acts (the guard in the SDK does this).";

  // For the Aegis-key path, identity is proven by a request that authenticated with the credential, so a freshly
  // rotated credential that has not been used yet is not yet verified.
  const identityAt = usesAegisKey ? (state === "WAITING" ? null : e.firstHandshakeAt) : (e.lastVerifiedAt ?? e.firstHandshakeAt);
  const steps: ConnectionStep[] = [
    { key: "identity", label: "Identity verified", done: identityAt !== null, at: identityAt },
    { key: "connection", label: "Connection established", done: e.firstHandshakeAt !== null && state !== "WAITING", at: e.firstHandshakeAt },
    { key: "activity", label: "First activity received", done: e.reportedEventCount > 0, at: null },
  ];

  return {
    state,
    stateLabel: copy[state].label,
    detail: copy[state].detail,
    reason,
    monitoring,
    monitoringLabel,
    protection,
    protectionLabel,
    protectionDetail,
    steps,
    firstHandshakeAt: e.firstHandshakeAt,
    lastSeenAt: contact ?? null,
    reportedEventCount: e.reportedEventCount,
  };
}
