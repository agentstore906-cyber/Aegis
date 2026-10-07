import { describe, expect, it } from "vitest";

import { NOT_SEEN_AFTER_MS, deriveConnectionView, type ConnectionEvidence } from "@/lib/agents/connection-state";
import { FORBIDDEN_CLAIMS } from "@/lib/ui/vocabulary";

const NOW = new Date("2026-10-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;

const base = (over: Partial<ConnectionEvidence> = {}): ConnectionEvidence => ({
  connectorType: "CUSTOM_SDK",
  status: "CONNECTING",
  disconnectedAt: null,
  firstHandshakeAt: null,
  lastSeenAt: null,
  lastVerifiedAt: null,
  lastHealthError: null,
  apiKey: { revokedAt: null, expiresAt: null },
  reportedEventCount: 0,
  lastReportedEventAt: null,
  decisionRequests7d: 0,
  ...over,
});

const connected = (over: Partial<ConnectionEvidence> = {}) =>
  base({ status: "CONNECTED", firstHandshakeAt: ago(2 * HOUR), lastSeenAt: ago(HOUR), ...over });

describe("connection state — nothing is connected until the agent has made contact", () => {
  it("a freshly issued credential is WAITING, with no step claimed", () => {
    const v = deriveConnectionView(base(), NOW);
    expect(v.state).toBe("WAITING");
    expect(v.steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(v.monitoring).toBe("NONE");
  });

  it("a CONNECTED status with no contact evidence is still WAITING for an Aegis-key connection", () => {
    // e.g. a row written as CONNECTED by older code, or a click that changed nothing real
    expect(deriveConnectionView(base({ status: "CONNECTED" }), NOW).state).toBe("WAITING");
  });

  it("contact makes it CONNECTED; each step is true only with its own evidence", () => {
    const afterHandshake = deriveConnectionView(connected(), NOW);
    expect(afterHandshake.state).toBe("CONNECTED");
    expect(afterHandshake.steps.map((s) => [s.key, s.done])).toEqual([
      ["identity", true],
      ["connection", true],
      ["activity", false], // handshake alone is not activity
    ]);

    const afterEvent = deriveConnectionView(connected({ reportedEventCount: 3, lastReportedEventAt: ago(HOUR) }), NOW);
    expect(afterEvent.steps.find((s) => s.key === "activity")?.done).toBe(true);
    expect(afterEvent.monitoring).toBe("RECEIVING");
  });

  it("a rotated credential that has not been used yet goes back to WAITING, history aside", () => {
    const v = deriveConnectionView(connected({ status: "CONNECTING" }), NOW);
    expect(v.state).toBe("WAITING");
    expect(v.steps[0].done).toBe(false);
    expect(v.steps[1].done).toBe(false);
  });
});

describe("silence is not death", () => {
  it("is NOT_SEEN_RECENTLY after 24 h of silence, and says so without claiming the agent is down", () => {
    const v = deriveConnectionView(connected({ lastSeenAt: ago(NOT_SEEN_AFTER_MS + HOUR) }), NOW);
    expect(v.state).toBe("NOT_SEEN_RECENTLY");
    expect(v.detail).toMatch(/may simply be idle/);
    expect(v.lastSeenAt).not.toBeNull();
  });
  it("stays CONNECTED just inside the window", () => {
    expect(deriveConnectionView(connected({ lastSeenAt: ago(NOT_SEEN_AFTER_MS - HOUR) }), NOW).state).toBe("CONNECTED");
  });
  it("monitoring goes quiet independently of the connection", () => {
    const v = deriveConnectionView(connected({ reportedEventCount: 5, lastReportedEventAt: ago(NOT_SEEN_AFTER_MS + HOUR) }), NOW);
    expect(v.monitoring).toBe("QUIET");
  });
});

describe("revoked, expired and failed", () => {
  it("DISCONNECTED and a revoked key are both REVOKED, and a revoked key outranks everything", () => {
    expect(deriveConnectionView(connected({ status: "DISCONNECTED", disconnectedAt: ago(HOUR) }), NOW).state).toBe("REVOKED");
    const v = deriveConnectionView(connected({ apiKey: { revokedAt: ago(HOUR), expiresAt: null } }), NOW);
    expect(v.state).toBe("REVOKED");
    expect(v.reason).toMatch(/revoked/);
  });
  it("an expired key is an ERROR that says why", () => {
    const v = deriveConnectionView(connected({ apiKey: { revokedAt: null, expiresAt: ago(HOUR) } }), NOW);
    expect(v.state).toBe("ERROR");
    expect(v.reason).toMatch(/expired/);
  });
  it("RECONNECT_REQUIRED surfaces the real health error, never a generic one", () => {
    const v = deriveConnectionView(connected({ status: "RECONNECT_REQUIRED", lastHealthError: "401 from provider" }), NOW);
    expect(v.state).toBe("ERROR");
    expect(v.reason).toBe("401 from provider");
  });
});

describe("provider connections", () => {
  it("a verified provider credential is CREDENTIAL_VERIFIED — not CONNECTED — until the agent contacts Aegis", () => {
    const v = deriveConnectionView(base({ connectorType: "OPENAI", status: "CONNECTED", lastVerifiedAt: ago(HOUR) }), NOW);
    expect(v.state).toBe("CREDENTIAL_VERIFIED");
    expect(v.steps.map((s) => s.done)).toEqual([true, false, false]);
  });
  it("becomes CONNECTED once the agent has reported something", () => {
    const v = deriveConnectionView(base({ connectorType: "OPENAI", status: "CONNECTED", lastVerifiedAt: ago(HOUR), reportedEventCount: 1, lastReportedEventAt: ago(HOUR) }), NOW);
    expect(v.state).toBe("CONNECTED");
  });
});

describe("protection is never overstated", () => {
  it("connected + monitored is still 'Monitoring only' when the agent never asks for decisions", () => {
    const v = deriveConnectionView(connected({ reportedEventCount: 10, lastReportedEventAt: ago(HOUR) }), NOW);
    expect(v.protection).toBe("MONITORING_ONLY");
    expect(v.protectionDetail).toMatch(/cannot stop/);
  });
  it("asking for decisions is 'Asks Aegis for decisions' with the honest caveat", () => {
    const v = deriveConnectionView(connected({ decisionRequests7d: 4 }), NOW);
    expect(v.protection).toBe("ASKS_FOR_DECISIONS");
    expect(v.protectionDetail).toMatch(/decides whether to honor|decide/);
  });
  it("no state, label or detail ever claims protection, prevention or enforcement", () => {
    const cases = [
      base(),
      connected(),
      connected({ decisionRequests7d: 9, reportedEventCount: 9, lastReportedEventAt: ago(HOUR) }),
      connected({ status: "DISCONNECTED" }),
      connected({ status: "FAILED", lastHealthError: "x" }),
      base({ connectorType: "ANTHROPIC", status: "CONNECTED", lastVerifiedAt: ago(HOUR) }),
    ];
    for (const evidence of cases) {
      const v = deriveConnectionView(evidence, NOW);
      const text = [v.stateLabel, v.detail, v.monitoringLabel, v.protectionLabel, v.protectionDetail, v.reason ?? ""].join(" | ");
      for (const forbidden of FORBIDDEN_CLAIMS) expect(text, text).not.toMatch(forbidden);
    }
  });
});

describe("monitoring label never outlives a usable connection", () => {
  const withEvents = { reportedEventCount: 5, lastReportedEventAt: ago(HOUR) };
  it("says Monitored only while connected and events are arriving", () => {
    expect(deriveConnectionView(connected(withEvents), NOW).monitoringLabel).toBe("Monitored");
  });
  it("does not say Monitored after disconnect, failure, or a replaced credential that has not been used", () => {
    const labels = [
      connected({ ...withEvents, status: "DISCONNECTED" }),
      connected({ ...withEvents, apiKey: { revokedAt: ago(HOUR), expiresAt: null } }),
      connected({ ...withEvents, status: "FAILED", lastHealthError: "x" }),
      connected({ ...withEvents, status: "CONNECTING" }),
    ].map((e) => deriveConnectionView(e, NOW).monitoringLabel);
    for (const label of labels) expect(label).toMatch(/^Not monitoring/);
  });
});

describe("connectionSummary (agent list status line)", () => {
  it("never claims more than the evidence: waiting is not connected, and monitoring is active only with recent events", async () => {
    const { connectionSummary } = await import("@/lib/agents/connection-state");
    const base = { stateLabel: "x" };
    expect(connectionSummary({ ...base, state: "WAITING", monitoring: "NONE" })).toBe("Waiting for connection");
    expect(connectionSummary({ ...base, state: "CONNECTED", monitoring: "NONE" })).toBe("Connected · Waiting for first activity");
    expect(connectionSummary({ ...base, state: "CONNECTED", monitoring: "RECEIVING" })).toBe("Connected · Monitoring active");
    expect(connectionSummary({ ...base, state: "CONNECTED", monitoring: "QUIET" })).not.toMatch(/active/i);
    expect(connectionSummary({ state: "REVOKED", stateLabel: "Revoked", monitoring: "RECEIVING" })).toBe("Revoked");
  });
});
