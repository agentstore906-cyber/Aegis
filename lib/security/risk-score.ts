import type { RiskLevel } from "@prisma/client";

/**
 * Transparent, deterministic Agent Risk Score (Phase 2 spec §3) — a
 * single 0-100 number that always comes with the reasons behind it. Like
 * lib/security/risk-scoring.ts's per-event scorer, this is deliberately
 * rule-based, not ML: every point on the score traces back to one named
 * factor, so "why is this 78?" always has a plain-English answer instead
 * of an opaque model output (see docs/behavioral-intelligence.md).
 *
 * Inputs are pre-fetched, already-scoped signals (lib/security/repository.ts
 * assembles them for one agent) — this file has no database access, which
 * keeps it fast to unit-test and keeps the actual queries in exactly one
 * place.
 */

export type RiskScoreSignals = {
  /** The agent's own configured risk classification — a starting point, not the whole score. */
  agentRiskLevel: RiskLevel;
  /** Open (OPEN or ACKNOWLEDGED) SecurityAlert counts by severity. */
  openCriticalAlerts: number;
  openHighAlerts: number;
  openMediumAlerts: number;
  /** An open NEW_SENSITIVE_ACTION or NEW_TOOL_USAGE alert — this agent recently gained a new capability, worth a light note even before it's proven risky. */
  hasNewCapabilityAlert: boolean;
  /** ActivityEvent rows with status BLOCKED in the trailing 7 days (regardless of who/what blocked them). */
  blockedActions7d: number;
  /** PolicyEvaluation rows with decision BLOCK in the trailing 7 days — Aegis's own policy engine denying the action before it happened. */
  policyViolations7d: number;
  /** ActivityEvent rows with status FAILED in the trailing 7 days. */
  failedActions7d: number;
  /** ActivityEvent rows whose action/resource matched a delete-shaped keyword in the trailing 7 days. */
  destructiveActions7d: number;
};

export type RiskScoreFactor = { label: string; points: number };
export type RiskScore = { score: number; factors: RiskScoreFactor[] };

const MAX_SCORE = 100;

const RISK_LEVEL_POINTS: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 8, HIGH: 20, CRITICAL: 35 };

/** Highest tier whose threshold `count` meets or exceeds — thresholds must be given in ascending `at` order. */
function tierPoints(count: number, thresholds: { at: number; points: number }[]): number {
  let points = 0;
  for (const tier of thresholds) {
    if (count >= tier.at) points = tier.points;
  }
  return points;
}

/**
 * Computes the 0-100 score and its plain-English reasons, most-impactful
 * first. Only factors that actually contributed points appear in
 * `factors` — an agent with nothing wrong gets an empty list and a score
 * near (or at) 0, never a padded-out explanation for a non-issue.
 */
export function computeAgentRiskScore(signals: RiskScoreSignals): RiskScore {
  const factors: RiskScoreFactor[] = [];
  let total = 0;

  const add = (points: number, label: string) => {
    if (points <= 0) return;
    total += points;
    factors.push({ label, points });
  };

  if (signals.agentRiskLevel !== "LOW") {
    add(
      RISK_LEVEL_POINTS[signals.agentRiskLevel],
      `Agent is configured as ${signals.agentRiskLevel.toLowerCase()} risk.`
    );
  }

  add(
    Math.min(signals.openCriticalAlerts * 15, 30),
    countedLabel(signals.openCriticalAlerts, "open critical security alert")
  );
  add(Math.min(signals.openHighAlerts * 8, 24), countedLabel(signals.openHighAlerts, "open high-severity security alert"));
  add(Math.min(signals.openMediumAlerts * 3, 9), countedLabel(signals.openMediumAlerts, "open medium-severity security alert"));

  if (signals.hasNewCapabilityAlert) {
    add(6, "Recently started using a new sensitive action or tool — not yet proven normal.");
  }

  add(
    tierPoints(signals.blockedActions7d, [
      { at: 1, points: 6 },
      { at: 5, points: 14 },
    ]),
    countedLabel(signals.blockedActions7d, "blocked action", "in the last 7 days")
  );

  add(
    tierPoints(signals.policyViolations7d, [
      { at: 1, points: 6 },
      { at: 5, points: 14 },
    ]),
    countedLabel(signals.policyViolations7d, "action denied by policy", "in the last 7 days")
  );

  add(
    tierPoints(signals.failedActions7d, [
      { at: 1, points: 4 },
      { at: 5, points: 10 },
    ]),
    countedLabel(signals.failedActions7d, "failed action", "in the last 7 days")
  );

  add(
    tierPoints(signals.destructiveActions7d, [
      { at: 1, points: 5 },
      { at: 3, points: 12 },
    ]),
    countedLabel(signals.destructiveActions7d, "destructive (delete-shaped) action", "in the last 7 days")
  );

  return {
    score: Math.min(MAX_SCORE, Math.round(total)),
    factors: factors.sort((a, b) => b.points - a.points),
  };
}

function countedLabel(count: number, singular: string, suffix?: string): string {
  const noun = count === 1 ? singular : `${singular}s`;
  return suffix ? `${count} ${noun} ${suffix}.` : `${count} ${noun}.`;
}
