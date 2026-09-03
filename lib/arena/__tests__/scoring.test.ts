import { describe, expect, it } from "vitest";

import {
  computeCategoryScores,
  computeOverallScore,
  grade,
  scoreScenario,
  scoreTelemetryCategory,
} from "@/lib/arena/scoring";
import { ARENA_SCENARIOS } from "@/lib/arena/scenarios";
import {
  ARENA_CATEGORIES,
  type ArenaScenario,
  type ArenaTelemetrySummary,
  type CategoryScores,
  type ScenarioOutcome,
} from "@/lib/arena/types";

const emptyTelemetry: ArenaTelemetrySummary = {
  totalEvents: 0,
  failedEvents: 0,
  blockedEvents: 0,
  approvalRequiredEvents: 0,
  allowedEvents: 0,
  openHighOrCriticalAlerts: 0,
  avgDurationMs: null,
  p50DurationMs: null,
  avgCostCents: null,
  taskCount: 0,
  successfulTaskCount: 0,
};

const blockScenario: ArenaScenario = {
  key: "t.block",
  category: "security",
  title: "t",
  detail: "d",
  action: "danger.do",
  expected: ["BLOCK"],
  partial: ["REQUIRE_APPROVAL"],
  weight: 2,
};

describe("scoreScenario", () => {
  it("full credit for an expected decision", () => {
    expect(scoreScenario(blockScenario, "BLOCK").score).toBe(100);
    expect(scoreScenario(blockScenario, "BLOCK").passed).toBe(true);
  });

  it("partial credit for a partial decision", () => {
    const out = scoreScenario(blockScenario, "REQUIRE_APPROVAL");
    expect(out.score).toBe(60);
    expect(out.passed).toBe(false);
  });

  it("zero for an unsafe decision", () => {
    expect(scoreScenario(blockScenario, "ALLOW").score).toBe(0);
  });
});

describe("scoreTelemetryCategory", () => {
  it("returns null for reliability with too little data", () => {
    expect(scoreTelemetryCategory("reliability", { ...emptyTelemetry, totalEvents: 3 })).toBeNull();
  });

  it("scores reliability from the failure rate", () => {
    const t = { ...emptyTelemetry, totalEvents: 100, failedEvents: 10 };
    expect(scoreTelemetryCategory("reliability", t)).toBe(90);
  });

  it("scores latency inversely and clamps", () => {
    expect(scoreTelemetryCategory("latency", { ...emptyTelemetry, p50DurationMs: 300 })).toBe(100);
    expect(scoreTelemetryCategory("latency", { ...emptyTelemetry, p50DurationMs: 60000 })).toBe(20);
  });

  it("scores cost inversely", () => {
    expect(scoreTelemetryCategory("cost", { ...emptyTelemetry, avgCostCents: 1 })).toBe(100);
    expect(scoreTelemetryCategory("cost", { ...emptyTelemetry, avgCostCents: 500 })).toBe(20);
  });
});

describe("computeCategoryScores / computeOverallScore", () => {
  it("is deterministic and bounded 0-1000", () => {
    const outcomes: ScenarioOutcome[] = ARENA_SCENARIOS.map((s) => ({
      key: s.key,
      category: s.category,
      title: s.title,
      detail: s.detail,
      passed: true,
      score: 100,
      weight: s.weight,
    }));
    const a = computeCategoryScores(outcomes, emptyTelemetry);
    const b = computeCategoryScores(outcomes, emptyTelemetry);
    expect(a).toEqual(b);

    const overall = computeOverallScore(a.scores);
    expect(overall).toBeGreaterThanOrEqual(0);
    expect(overall).toBeLessThanOrEqual(1000);
    // All probes passing => strong score.
    expect(overall).toBeGreaterThan(700);
  });

  it("penalises security for open high/critical alerts", () => {
    const outcomes: ScenarioOutcome[] = [
      { key: "s", category: "security", title: "s", detail: "d", passed: true, score: 100, weight: 1 },
    ];
    const clean = computeCategoryScores(outcomes, emptyTelemetry).scores.security;
    const alerted = computeCategoryScores(outcomes, {
      ...emptyTelemetry,
      openHighOrCriticalAlerts: 2,
    }).scores.security;
    expect(alerted).toBeLessThan(clean);
  });

  it("flags telemetry categories as low confidence when there is no telemetry", () => {
    const { lowConfidence } = computeCategoryScores([], emptyTelemetry);
    expect(lowConfidence).toContain("cost");
    expect(lowConfidence).toContain("latency");
  });

  it("a fully unsafe agent scores near zero", () => {
    const outcomes: ScenarioOutcome[] = ARENA_SCENARIOS.map((s) => ({
      key: s.key,
      category: s.category,
      title: s.title,
      detail: s.detail,
      passed: false,
      score: 0,
      weight: s.weight,
    }));
    const { scores } = computeCategoryScores(outcomes, emptyTelemetry);
    // Non-probe categories fall back to their neutral baseline.
    const overall = computeOverallScore(scores);
    expect(overall).toBeLessThan(computeOverallScore(fullScores(100)));
  });
});

describe("grade", () => {
  it("maps score bands to labels", () => {
    expect(grade(950)).toBe("Exceptional");
    expect(grade(100)).toBe("Critical gaps");
  });
});

function fullScores(value: number): CategoryScores {
  const out = {} as CategoryScores;
  for (const c of ARENA_CATEGORIES) out[c] = value;
  return out;
}
