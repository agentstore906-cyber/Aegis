import { describe, expect, it } from "vitest";

import { connectionPhase, connectionStages, type PhaseEvidence } from "@/lib/agents/connection-phase";

const steps = (identity: boolean, connection: boolean, activity: boolean) => [
  { key: "identity" as const, done: identity },
  { key: "connection" as const, done: connection },
  { key: "activity" as const, done: activity },
];
const ev = (over: Partial<PhaseEvidence>): PhaseEvidence => ({ state: "WAITING", monitoring: "NONE", firstHandshakeAt: null, steps: steps(false, false, false), ...over });

describe("connectionPhase", () => {
  it("is IDLE with no evidence", () => expect(connectionPhase(null)).toBe("IDLE"));

  it("is CONNECTING for a credential nothing has used", () => expect(connectionPhase(ev({}))).toBe("CONNECTING"));

  it("is RECONNECTING when a previously connected agent waits again", () => {
    expect(connectionPhase(ev({ firstHandshakeAt: "2026-10-01T00:00:00.000Z" }))).toBe("RECONNECTING");
  });

  it("is AUTHENTICATING when a provider credential is verified but the agent has not made contact", () => {
    expect(connectionPhase(ev({ state: "CREDENTIAL_VERIFIED", steps: steps(true, false, false) }))).toBe("AUTHENTICATING");
  });

  it("is VERIFYING when connected but no activity has arrived — never CONNECTED-and-monitored", () => {
    expect(connectionPhase(ev({ state: "CONNECTED", firstHandshakeAt: "2026-10-01T00:00:00.000Z", steps: steps(true, true, false) }))).toBe("VERIFYING");
  });

  it("is CONNECTED once activity is reported", () => {
    expect(connectionPhase(ev({ state: "CONNECTED", monitoring: "RECEIVING", steps: steps(true, true, true) }))).toBe("CONNECTED");
  });

  it("treats a quiet, previously connected agent as connected, not failed", () => {
    expect(connectionPhase(ev({ state: "NOT_SEEN_RECENTLY", monitoring: "QUIET", steps: steps(true, true, true) }))).toBe("CONNECTED");
  });

  it("maps backend errors and revocations to FAILED and DISCONNECTED", () => {
    expect(connectionPhase(ev({ state: "ERROR" }))).toBe("FAILED");
    expect(connectionPhase(ev({ state: "REVOKED" }))).toBe("DISCONNECTED");
  });
});

describe("connectionStages", () => {
  it("marks nothing done before the backend confirms anything", () => {
    const s = connectionStages(ev({}));
    expect(s.map((x) => x.status)).toEqual(["current", "pending", "pending", "pending"]);
  });

  it("marks a stage done only when its evidence exists", () => {
    const s = connectionStages(ev({ state: "CONNECTED", firstHandshakeAt: "2026-10-01T00:00:00.000Z", steps: steps(true, true, false) }));
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done", "current"]);
  });

  it("completes every stage only when monitoring is really receiving", () => {
    const s = connectionStages(ev({ state: "CONNECTED", monitoring: "RECEIVING", steps: steps(true, true, true) }));
    expect(s.every((x) => x.status === "done")).toBe(true);
  });

  it("shows the first unconfirmed stage as failed when the backend reports an unusable connection", () => {
    const s = connectionStages(ev({ state: "ERROR" }));
    expect(s[0]!.status).toBe("failed");
    expect(s.slice(1).every((x) => x.status === "pending")).toBe(true);
  });
});
