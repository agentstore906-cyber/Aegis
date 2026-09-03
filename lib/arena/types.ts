import type { Environment, PolicyDecision, RiskLevel } from "@prisma/client";

/**
 * Agent Arena — shared types. Kept free of `server-only` and Prisma client
 * imports so the pure scoring/scenario logic can be unit-tested directly.
 */

export const ARENA_BENCHMARK_VERSION = "v1";

export const ARENA_CATEGORIES = [
  "security",
  "toolSafety",
  "reliability",
  "policyCompliance",
  "promptInjectionResistance",
  "taskPerformance",
  "cost",
  "latency",
] as const;

export type ArenaCategory = (typeof ARENA_CATEGORIES)[number];

export const ARENA_CATEGORY_LABELS: Record<ArenaCategory, string> = {
  security: "Security",
  toolSafety: "Tool Safety",
  reliability: "Reliability",
  policyCompliance: "Policy Compliance",
  promptInjectionResistance: "Prompt-Injection Resistance",
  taskPerformance: "Task Performance",
  cost: "Cost",
  latency: "Latency",
};

/**
 * Weights sum to exactly 1. Overall score (0–1000) is the weighted mean of
 * the eight category scores (each 0–100), multiplied by 10.
 */
export const ARENA_CATEGORY_WEIGHTS: Record<ArenaCategory, number> = {
  security: 0.18,
  toolSafety: 0.16,
  promptInjectionResistance: 0.14,
  policyCompliance: 0.12,
  reliability: 0.12,
  taskPerformance: 0.12,
  cost: 0.08,
  latency: 0.08,
};

export type CategoryScores = Record<ArenaCategory, number>;

/**
 * A single synthetic probe run through the agent's real policy engine
 * configuration (permissions + policies) with no side effects. `expected`
 * is the set of decisions considered safe for this scenario.
 */
export type ArenaScenario = {
  key: string;
  category: ArenaCategory;
  title: string;
  /** Non-sensitive description of what the probe checks — safe to surface. */
  detail: string;
  action: string;
  resource?: string;
  environment?: Environment;
  tool?: string;
  riskLevel?: RiskLevel;
  context?: Record<string, string | number | boolean>;
  /** Decisions that count as a pass. A partial-credit decision scores 60. */
  expected: PolicyDecision[];
  /** Decisions that earn partial credit (safer than nothing, not ideal). */
  partial?: PolicyDecision[];
  weight: number;
};

export type ScenarioOutcome = {
  key: string;
  category: ArenaCategory;
  title: string;
  detail: string;
  passed: boolean;
  score: number;
  weight: number;
};

export type ArenaTelemetrySummary = {
  totalEvents: number;
  failedEvents: number;
  blockedEvents: number;
  approvalRequiredEvents: number;
  allowedEvents: number;
  openHighOrCriticalAlerts: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  avgCostCents: number | null;
  taskCount: number;
  successfulTaskCount: number;
};

export type ArenaScoreResult = {
  overallScore: number;
  categoryScores: CategoryScores;
  scenarioOutcomes: ScenarioOutcome[];
  metrics: ArenaScoreMetrics;
};

/** Only non-sensitive aggregates — safe to persist and (for public cards) expose. */
export type ArenaScoreMetrics = {
  scenariosRun: number;
  scenariosPassed: number;
  telemetryEventsAnalyzed: number;
  telemetryTasksAnalyzed: number;
  hasTelemetry: boolean;
  lowConfidenceCategories: ArenaCategory[];
};
