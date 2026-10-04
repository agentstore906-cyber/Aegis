/** P3 — trust scoring, states, hysteresis, recovery, and explanations. Pure: no database. */
import { describe, expect, it } from "vitest";

import { TRUST_CATEGORIES, TRUST_MIN_SCORE_DELTA, TRUST_RECOVERY_MARGIN, TRUST_THRESHOLDS } from "@/lib/trust/config";
import { computeTrust, decay, describeTransition, headline, isMeaningfulChange, stateForScore } from "@/lib/trust/score";
import type { TrustEvidence, TrustSnapshot } from "@/lib/trust/types";

const DAY = 86_400_000;
const now = new Date("2026-10-10T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

/** A mature, clean agent: 60 days old, established baseline, nothing adverse. */
function clean(overrides: Partial<TrustEvidence> = {}): TrustEvidence {
  return {
    agent: { status: "ACTIVE", createdAt: ago(60 * DAY) },
    baselineMaturity: "ESTABLISHED",
    deviations: [],
    blocks: [],
    violations: [],
    alerts: [],
    rejectedApprovals: [],
    ...overrides,
  };
}

const deviation = (id: string, kind: TrustEvidence["deviations"][number]["kind"], key: string, extra: Partial<TrustEvidence["deviations"][number]> = {}) => ({
  id,
  kind,
  dedupeKey: key,
  confidence: "HIGH" as const,
  occurrences: 1,
  lastSeenAt: ago(0),
  ...extra,
});

const snapshot = (r: ReturnType<typeof computeTrust>): TrustSnapshot => ({ state: r.state, score: r.score, factors: r.factors, limits: r.limits });

describe("initialization", () => {
  it("a mature agent with no negative evidence is TRUSTED at 100", () => {
    const r = computeTrust(clean(), now, null);
    expect(r).toMatchObject({ state: "TRUSTED", score: 100, evidenceScore: 100, factors: [], limits: [] });
  });

  it("a brand-new agent is NORMAL, capped at 84, and says why (absence of evidence is not trust)", () => {
    const r = computeTrust(clean({ agent: { status: "ACTIVE", createdAt: ago(2 * DAY) }, baselineMaturity: null }), now, null);
    expect(r.state).toBe("NORMAL");
    expect(r.score).toBe(TRUST_THRESHOLDS.TRUSTED.min - 1);
    expect(r.evidenceScore).toBe(100);
    expect(r.limits).toHaveLength(1);
    expect(r.limits[0]).toMatchObject({ code: "INSUFFICIENT_HISTORY", ceiling: 84 });
    expect(r.limits[0].summary).toContain("2 days old");
    expect(r.limits[0].summary).toContain("new agent");
  });

  it("either missing requirement alone keeps the cap: old agent with a limited baseline, young agent with an established one", () => {
    expect(computeTrust(clean({ baselineMaturity: "LIMITED_HISTORY" }), now, null).state).toBe("NORMAL");
    expect(computeTrust(clean({ agent: { status: "ACTIVE", createdAt: ago(3 * DAY) } }), now, null).state).toBe("NORMAL");
    expect(computeTrust(clean({ agent: { status: "ACTIVE", createdAt: ago(14 * DAY) } }), now, null).state).toBe("TRUSTED");
  });
});

describe("degradation", () => {
  it("a high-confidence new destination costs 10 points and is explained", () => {
    const r = computeTrust(clean({ deviations: [deviation("d1", "NEW_DESTINATION", "destination:evil.example.com")] }), now, "TRUSTED");
    expect(r.score).toBe(90);
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0]).toMatchObject({
      category: "behavior",
      code: "NEW_DESTINATION",
      points: 10,
      summary: "New destination: evil.example.com",
      evidence: [{ type: "behavioral_deviation", id: "d1" }],
    });
  });

  it("confidence scales the weight: LOW counts 40%", () => {
    const r = computeTrust(clean({ deviations: [deviation("d1", "NEW_DESTINATION", "destination:x", { confidence: "LOW" })] }), now, null);
    expect(r.factors[0].points).toBe(4);
  });

  it("combines categories and crosses state thresholds: 3 deviations + blocks + a HIGH alert → DEGRADED", () => {
    const r = computeTrust(
      clean({
        deviations: [
          deviation("d1", "NEW_DESTINATION", "destination:a"),
          deviation("d2", "UNUSUAL_VOLUME", "volume:records"),
          deviation("d3", "UNUSUAL_DATA_TYPE", "dataClass:PII"),
        ],
        blocks: [{ id: "b1", action: "refund.issue", decisionSource: "POLICY", createdAt: ago(0) }],
        alerts: [{ id: "a1", type: "HIGH_RISK_BURST", title: "Burst", severity: "HIGH", status: "OPEN", lastSeenAt: ago(0) }],
      }),
      now,
      "TRUSTED"
    );
    // 30 (behavior) + 6 (blocked) + 15 (alert) = 51 → 49
    expect(r.score).toBe(49);
    expect(r.state).toBe("DEGRADED");
    expect(r.categories.find((c) => c.category === "behavior")).toMatchObject({ raw: 30, applied: 30, capped: false });
  });

  it("every category is capped, so no single noisy source can zero the score on its own", () => {
    const blocks = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, action: `act.${i}`, decisionSource: "POLICY", createdAt: ago(0) }));
    const r = computeTrust(clean({ blocks }), now, null);
    const cap = TRUST_CATEGORIES.blocked.cap;
    expect(r.score).toBe(100 - cap);
    expect(r.categories.find((c) => c.category === "blocked")).toMatchObject({ applied: cap, capped: true });
    // Listed factor points still add up to what was applied (scaled, not lost).
    const listed = r.factors.reduce((s, f) => s + f.points, 0) + r.omittedFactors * 0;
    expect(listed).toBeLessThanOrEqual(cap + 0.5);
  });

  it("groups a retry loop into one explained factor per action instead of fifty lines", () => {
    const blocks = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, action: "refund.issue", decisionSource: "POLICY", createdAt: ago(0) }));
    const r = computeTrust(clean({ blocks }), now, null);
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0].summary).toBe("refund.issue blocked by policy (50 times)");
    expect(r.factors[0].evidence.length).toBeLessThanOrEqual(10);
  });

  it("an attempt without any permission (default deny) weighs less than an explicit policy block", () => {
    const policy = computeTrust(clean({ blocks: [{ id: "1", action: "x", decisionSource: "POLICY", createdAt: ago(0) }] }), now, null);
    const deny = computeTrust(clean({ blocks: [{ id: "1", action: "x", decisionSource: "DEFAULT_DENY", createdAt: ago(0) }] }), now, null);
    expect(policy.factors[0].points).toBe(6);
    expect(deny.factors[0].points).toBe(4);
    expect(deny.factors[0].summary).toContain("without a permission");
  });

  it("an operator pause or stop restricts the agent regardless of a perfect record, and says so", () => {
    for (const status of ["PAUSED", "STOPPED"] as const) {
      const r = computeTrust(clean({ agent: { status, createdAt: ago(60 * DAY) } }), now, "TRUSTED");
      expect(r.state).toBe("RESTRICTED");
      expect(r.score).toBe(100);
      expect(r.limits[0]).toMatchObject({ code: "OPERATOR_CONTROL", ceiling: null });
    }
    expect(headline(snapshot(computeTrust(clean({ agent: { status: "STOPPED", createdAt: ago(60 * DAY) } }), now, null)))).toContain("kill switch");
  });
});

describe("repeated incidents", () => {
  it("the same deviation repeating weighs more, up to 1.5×", () => {
    const once = computeTrust(clean({ deviations: [deviation("d", "NEW_DESTINATION", "destination:x")] }), now, null).factors[0].points;
    const thrice = computeTrust(clean({ deviations: [deviation("d", "NEW_DESTINATION", "destination:x", { occurrences: 3 })] }), now, null).factors[0].points;
    const many = computeTrust(clean({ deviations: [deviation("d", "NEW_DESTINATION", "destination:x", { occurrences: 50 })] }), now, null).factors[0].points;
    expect(once).toBe(10);
    expect(thrice).toBe(12);
    expect(many).toBe(15);
  });

  it("repeated blocks accumulate and a growing history keeps lowering the score until the cap", () => {
    const at = (n: number) =>
      computeTrust(
        clean({ blocks: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, action: "a", decisionSource: "POLICY", createdAt: ago(0) })) }),
        now,
        null
      ).score;
    expect([at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([94, 88, 82, 76, 70, 70]);
  });
});

describe("recovery", () => {
  it("evidence fades linearly, so the score recovers by itself as behavior stays normal", () => {
    const dev = (age: number) => clean({ deviations: [deviation("d", "NEW_DESTINATION", "destination:x", { lastSeenAt: ago(age) })] });
    expect(computeTrust(dev(0), now, null).score).toBe(90);
    expect(computeTrust(dev(3.5 * DAY), now, null).score).toBe(95);
    expect(computeTrust(dev(7 * DAY), now, null).score).toBe(100);
    expect(computeTrust(dev(30 * DAY), now, null).factors).toEqual([]);
  });

  it("a resolved alert weighs a quarter of an open one; an acknowledged one three quarters", () => {
    const alert = (status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED") =>
      computeTrust(clean({ alerts: [{ id: "a", type: "HIGH_RISK_BURST", title: "t", severity: "HIGH", status, lastSeenAt: ago(0) }] }), now, null).factors[0].points;
    expect([alert("OPEN"), alert("ACKNOWLEDGED"), alert("RESOLVED")]).toEqual([15, 11.3, 3.8]);
  });

  it("nothing is permanent: even a CRITICAL open alert is gone after its 30-day window", () => {
    const old = clean({ alerts: [{ id: "a", type: "CREDENTIAL_EXPOSURE_DETECTED", title: "t", severity: "CRITICAL", status: "OPEN", lastSeenAt: ago(31 * DAY) }] });
    expect(computeTrust(old, now, "HIGH_RISK")).toMatchObject({ score: 100, state: "TRUSTED", factors: [] });
  });

  it("an ESTABLISHED agent recovers DEGRADED → NORMAL → TRUSTED as evidence ages out", () => {
    const evidence = (age: number) =>
      clean({
        deviations: [
          deviation("d1", "NEW_DESTINATION", "destination:a", { lastSeenAt: ago(age) }),
          deviation("d2", "UNUSUAL_VOLUME", "volume:records", { lastSeenAt: ago(age) }),
          deviation("d3", "UNUSUAL_DATA_TYPE", "dataClass:PII", { lastSeenAt: ago(age) }),
        ],
        blocks: Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, action: "x", decisionSource: "POLICY", createdAt: ago(age) })),
      });
    let previous = computeTrust(evidence(0), now, "TRUSTED");
    expect(previous.state).toBe("DEGRADED"); // 30 + 24 = 54 → 46
    const states = [previous.state];
    for (const age of [2 * DAY, 4 * DAY, 6 * DAY, 8 * DAY]) {
      previous = computeTrust(evidence(age), now, previous.state);
      states.push(previous.state);
    }
    expect(states[0]).toBe("DEGRADED");
    expect(states.at(-1)).toBe("TRUSTED");
    // Monotone recovery: never worse as evidence ages.
    const order = ["TRUSTED", "NORMAL", "DEGRADED", "HIGH_RISK", "RESTRICTED"];
    for (let i = 1; i < states.length; i += 1) expect(order.indexOf(states[i])).toBeLessThanOrEqual(order.indexOf(states[i - 1]));
  });

  it("decay() is 1 now (or in the clock-skewed future), linear in between, and 0 at the window end", () => {
    expect(decay(ago(-1000), now, 7 * DAY)).toBe(1);
    expect(decay(ago(0), now, 7 * DAY)).toBe(1);
    expect(decay(ago(3.5 * DAY), now, 7 * DAY)).toBe(0.5);
    expect(decay(ago(7 * DAY), now, 7 * DAY)).toBe(0);
    expect(decay(ago(70 * DAY), now, 7 * DAY)).toBe(0);
  });
});

describe("hysteresis", () => {
  it("degrades at the plain threshold but recovers only with the margin, so a boundary score doesn't flap", () => {
    expect(stateForScore(60, "TRUSTED")).toBe("NORMAL");
    expect(stateForScore(59, "NORMAL")).toBe("DEGRADED");
    // Recovering into NORMAL from DEGRADED needs 60 + margin.
    expect(stateForScore(60, "DEGRADED")).toBe("DEGRADED");
    expect(stateForScore(60 + TRUST_RECOVERY_MARGIN - 1, "DEGRADED")).toBe("DEGRADED");
    expect(stateForScore(60 + TRUST_RECOVERY_MARGIN, "DEGRADED")).toBe("NORMAL");
    expect(stateForScore(85 + TRUST_RECOVERY_MARGIN - 1, "NORMAL")).toBe("NORMAL");
    expect(stateForScore(85 + TRUST_RECOVERY_MARGIN, "NORMAL")).toBe("TRUSTED");
  });

  it("with no previous state there is no margin", () => {
    expect(stateForScore(85, null)).toBe("TRUSTED");
    expect(stateForScore(60, null)).toBe("NORMAL");
    expect(stateForScore(0, null)).toBe("RESTRICTED");
  });

  it("an agent in HIGH_RISK stays out of NORMAL until it clears the margin", () => {
    expect(stateForScore(62, "HIGH_RISK")).toBe("DEGRADED");
    expect(stateForScore(65, "HIGH_RISK")).toBe("NORMAL");
  });
});

describe("what counts as a meaningful change", () => {
  it("initialization, any state change, or a move of at least the minimum delta — never noise", () => {
    expect(isMeaningfulChange(null, { state: "NORMAL", score: 84 })).toBe(true);
    expect(isMeaningfulChange({ state: "TRUSTED", score: 90 }, { state: "NORMAL", score: 84 })).toBe(true);
    expect(isMeaningfulChange({ state: "TRUSTED", score: 100 }, { state: "TRUSTED", score: 100 - TRUST_MIN_SCORE_DELTA })).toBe(true);
    expect(isMeaningfulChange({ state: "TRUSTED", score: 100 }, { state: "TRUSTED", score: 100 - TRUST_MIN_SCORE_DELTA + 1 })).toBe(false);
    expect(isMeaningfulChange({ state: "TRUSTED", score: 100 }, { state: "TRUSTED", score: 100 })).toBe(false);
  });
});

describe("explanations", () => {
  it("initialization states the score, the evidence lowering it, and the limits", () => {
    const next = snapshot(computeTrust(clean({ agent: { status: "ACTIVE", createdAt: ago(DAY) }, baselineMaturity: null }), now, null));
    const d = describeTransition(null, next);
    expect(d.direction).toBe("initialized");
    expect(d.summary).toContain("Trust initialized as Normal (score 84)");
    expect(d.summary).toContain("No negative evidence");
    expect(d.summary).toContain("Not enough history");
  });

  it("degradation names the new evidence that caused it, biggest first", () => {
    const before = snapshot(computeTrust(clean(), now, null));
    const after = snapshot(
      computeTrust(
        clean({
          deviations: [deviation("d1", "NEW_DESTINATION", "destination:evil.example.com"), deviation("d2", "UNUSUAL_VOLUME", "volume:records")],
          violations: [{ id: "v1", action: "export.data", createdAt: ago(0) }],
        }),
        now,
        "TRUSTED"
      )
    );
    const d = describeTransition(before, after);
    expect(d.direction).toBe("degraded");
    expect(d.summary).toBe(
      "Trust degraded from Trusted to Normal (100 → 75) because New destination: evil.example.com; Unusual data volume (records); Policy violation on export.data (1 time)."
    );
    expect(d.changes.map((c) => [c.kind, c.category])).toEqual([
      ["added", "behavior"],
      ["added", "behavior"],
      ["added", "violations"],
    ]);
  });

  it("recovery says which evidence no longer weighs as much, or the limit that was lifted", () => {
    const dirty = snapshot(computeTrust(clean({ deviations: [deviation("d1", "NEW_DESTINATION", "destination:x"), deviation("d2", "UNUSUAL_VOLUME", "volume:records")] }), now, null));
    const healed = snapshot(computeTrust(clean(), now, dirty.state));
    const d = describeTransition(dirty, healed);
    expect(d.direction).toBe("recovered");
    expect(d.summary).toMatch(/^Trust recovered from Normal to Trusted \(80 → 100\) because these no longer weigh as much: New destination: x/);

    const limited = snapshot(computeTrust(clean({ baselineMaturity: "LIMITED_HISTORY" }), now, null));
    const matured = snapshot(computeTrust(clean(), now, limited.state));
    expect(describeTransition(limited, matured).summary).toContain("history is now sufficient for Trusted");
  });

  it("an operator restriction is named as the reason", () => {
    const before = snapshot(computeTrust(clean(), now, null));
    const after = snapshot(computeTrust(clean({ agent: { status: "STOPPED", createdAt: ago(60 * DAY) } }), now, "TRUSTED"));
    const d = describeTransition(before, after);
    expect(d.direction).toBe("degraded");
    expect(d.summary).toContain("an operator restricted the agent");
  });

  it("the headline answers 'why' from the same evidence", () => {
    const r = computeTrust(clean({ deviations: [deviation("d1", "NEW_DESTINATION", "destination:x.example.com")] }), now, null);
    expect(headline(snapshot(r))).toBe("Trusted because of: New destination: x.example.com (−10).");
    expect(headline(snapshot(computeTrust(clean(), now, null)))).toContain("No negative evidence");
  });
});

describe("transparency", () => {
  it("every point of the score is accounted for by a listed factor (within rounding)", () => {
    const r = computeTrust(
      clean({
        deviations: [deviation("d1", "NEW_DESTINATION", "destination:a"), deviation("d2", "NEW_TOOL", "tool:t")],
        blocks: [{ id: "b", action: "x", decisionSource: "POLICY", createdAt: ago(DAY) }],
        rejectedApprovals: [{ id: "r", action: "wire.send", resolvedAt: ago(DAY) }],
      }),
      now,
      null
    );
    const listed = r.factors.reduce((s, f) => s + f.points, 0);
    expect(Math.abs(100 - r.evidenceScore - listed)).toBeLessThan(1);
  });
});
