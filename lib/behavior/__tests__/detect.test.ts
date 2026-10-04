/** P2 — deviation rules: cold-start gating, every kind, explanations. Pure. */
import { describe, expect, it } from "vitest";
import type { BaselineMaturity } from "@prisma/client";

import { detectDeviations } from "@/lib/behavior/detect";
import { buildProfile, type CategoricalRow } from "@/lib/behavior/profile";
import type { BaselineSnapshot, EventFeatures } from "@/lib/behavior/types";

const windowEnd = new Date("2026-10-03T00:00:00.000Z");
const windowStart = new Date("2026-09-05T00:00:00.000Z");

function row(dimension: string, key: string, count: number, daysSeen: number): CategoricalRow {
  return { dimension, key, count, daysSeen, firstSeen: windowStart, lastSeen: windowEnd };
}

/** 20 active days, hours 09–17 UTC, 2 events/hour — an established, regular agent. */
function establishedSnapshot(extraCategorical: CategoricalRow[] = [], maturity?: BaselineMaturity): BaselineSnapshot {
  const hourlyTotals = [];
  for (let d = 1; d <= 20; d += 1) {
    for (let h = 9; h <= 17; h += 1) {
      hourlyTotals.push({ hourStart: new Date(windowEnd.getTime() - d * 86_400_000 + h * 3_600_000), count: 2 });
    }
  }
  const built = buildProfile({
    windowStart,
    windowEnd,
    categorical: [
      row("tool", "crm", 360, 20),
      row("destination", "api.crm.example.com", 300, 20),
      row("destination", "seen-once.example.com", 1, 1),
      row("service", "crm-api", 360, 20),
      row("eventType", "TOOL_CALL", 360, 20),
      row("dataClass", "INTERNAL", 360, 20),
      row("transition", "crm.read>crm.update", 180, 20),
      row("endUser", "as1:u1", 200, 20),
      row("endUser", "as1:u2", 160, 20),
      ...extraCategorical,
    ],
    hourlyTotals,
    excludedHours: new Set(),
    recordCounts: Array.from({ length: 100 }, () => 10),
    byteCounts: Array.from({ length: 100 }, () => 2048),
  });
  return { version: 3, maturity: maturity ?? built.maturity, profile: built.profile };
}

const normalEvent: EventFeatures = {
  eventId: "evt",
  timestamp: new Date("2026-10-03T10:30:00.000Z"),
  eventType: "TOOL_CALL",
  toolKey: "crm",
  service: "crm-api",
  destination: "api.crm.example.com",
  dataClasses: ["INTERNAL"],
  endUserHash: "as1:u1",
  recordCount: 10,
  byteCount: 2048,
  transition: "crm.read>crm.update",
};
const kinds = (out: ReturnType<typeof detectDeviations>) => out.map((d) => d.kind).sort();

describe("cold start", () => {
  it("no baseline, or NEW_AGENT: nothing is evaluated at all", () => {
    expect(detectDeviations(null, { ...normalEvent, destination: "brand-new.example.com" }, 999)).toEqual([]);
    const snapshot = establishedSnapshot([], "NEW_AGENT");
    expect(detectDeviations(snapshot, { ...normalEvent, destination: "brand-new.example.com", recordCount: 1e6 }, 999)).toEqual([]);
  });

  it("LIMITED_HISTORY: only first-time values, at LOW confidence — no volume/frequency/time claims", () => {
    const snapshot = establishedSnapshot([], "LIMITED_HISTORY");
    const out = detectDeviations(
      snapshot,
      { ...normalEvent, destination: "brand-new.example.com", recordCount: 1e6, timestamp: new Date("2026-10-03T03:00:00Z") },
      999
    );
    expect(kinds(out)).toEqual(["NEW_DESTINATION"]);
    expect(out[0].confidence).toBe("LOW");
  });
});

describe("ESTABLISHED baseline", () => {
  const snapshot = establishedSnapshot();

  it("an ordinary event produces nothing", () => {
    expect(snapshot.maturity).toBe("ESTABLISHED");
    expect(detectDeviations(snapshot, normalEvent, 2)).toEqual([]);
  });

  it("new tool / destination / service / data type / action type / sequence", () => {
    const out = detectDeviations(
      snapshot,
      {
        ...normalEvent,
        toolKey: "shell",
        destination: "files.example-share.io",
        service: "dropbox",
        dataClasses: ["INTERNAL", "CREDENTIALS"],
        eventType: "DATA_ACCESS",
        transition: "crm.read>files.upload",
      },
      2
    );
    expect(kinds(out)).toEqual([
      "NEW_ACTION_TYPE",
      "NEW_DESTINATION",
      "NEW_SERVICE",
      "NEW_TOOL",
      "UNUSUAL_DATA_TYPE",
      "UNUSUAL_SEQUENCE",
    ]);
  });

  it("explains WHAT changed, WHY it's unusual, and WHAT was expected", () => {
    const [d] = detectDeviations(snapshot, { ...normalEvent, destination: "files.example-share.io" }, 2);
    expect(d.kind).toBe("NEW_DESTINATION");
    expect(d.explanation).toContain('"files.example-share.io"');
    expect(d.explanation).toContain("never seen in the last 28 days");
    expect(d.explanation).toContain("api.crm.example.com");
    expect(d.observed).toMatchObject({ dimension: "destination", value: "files.example-share.io", previouslySeen: null });
    expect(d.expected).toMatchObject({ establishedCount: 1, observations: 301, windowDays: 28 });
    expect(d.dedupeKey).toBe("destination:files.example-share.io");
    expect(d.confidence).toBe("HIGH");
  });

  it("a value seen briefly before is still not normal, and says so", () => {
    const [d] = detectDeviations(snapshot, { ...normalEvent, destination: "seen-once.example.com" }, 2);
    expect(d.explanation).toContain("appeared only 1 time(s) on 1 day(s)");
    expect(d.observed).toMatchObject({ previouslySeen: { count: 1, daysSeen: 1 } });
  });

  it("no novelty claims on a dimension the agent barely reports", () => {
    const sparse = establishedSnapshot();
    sparse.profile.dimensions.service = { ...sparse.profile.dimensions.service, observations: 5 };
    expect(kinds(detectDeviations(sparse, { ...normalEvent, service: "new-service" }, 2))).toEqual([]);
  });

  it("new end users only matter for agents with a small, fixed set of users", () => {
    expect(kinds(detectDeviations(snapshot, { ...normalEvent, endUserHash: "as1:u999" }, 2))).toEqual(["NEW_END_USER"]);
    const many = establishedSnapshot(Array.from({ length: 30 }, (_, i) => row("endUser", `as1:x${i}`, 10, 5)));
    expect(kinds(detectDeviations(many, { ...normalEvent, endUserHash: "as1:u999" }, 2))).toEqual([]);
  });

  it("unusual volume: above max(3 × p95, normal max); a modest increase is not flagged", () => {
    expect(kinds(detectDeviations(snapshot, { ...normalEvent, recordCount: 25 }, 2))).toEqual([]);
    const out = detectDeviations(snapshot, { ...normalEvent, recordCount: 48_000 }, 2);
    expect(kinds(out)).toEqual(["UNUSUAL_VOLUME"]);
    expect(out[0].explanation).toContain("48,000 records");
    expect(out[0].explanation).toContain("95th percentile of 10");
    expect(out[0].expected).toMatchObject({ p95: 10, max: 10, threshold: 30 });
  });

  it("unusual frequency: this hour well above the agent's busiest normal hours", () => {
    expect(kinds(detectDeviations(snapshot, normalEvent, 15))).toEqual([]);
    const out = detectDeviations(snapshot, normalEvent, 120);
    expect(kinds(out)).toEqual(["UNUSUAL_FREQUENCY"]);
    expect(out[0].dedupeKey).toBe("hour:2026-10-03T10:00:00.000Z");
    expect(out[0].explanation).toContain("120 events");
    expect(out[0].expected).toMatchObject({ median: 2, p95: 2, threshold: 22 });
  });

  it("unusual time: an hour of day this agent has never been active in", () => {
    const out = detectDeviations(snapshot, { ...normalEvent, timestamp: new Date("2026-10-03T03:15:00Z") }, 1);
    expect(kinds(out)).toEqual(["UNUSUAL_TIME"]);
    expect(out[0].explanation).toContain("between 03:00 and 04:00 UTC");
    expect(out[0].explanation).toContain("active on 20 of the last 28 days");
  });

  it("does not claim 'never at this hour' without enough active days", () => {
    const shortHistory = establishedSnapshot();
    shortHistory.profile.activeDays = 10;
    expect(kinds(detectDeviations(shortHistory, { ...normalEvent, timestamp: new Date("2026-10-03T03:15:00Z") }, 1))).toEqual([]);
  });
});
