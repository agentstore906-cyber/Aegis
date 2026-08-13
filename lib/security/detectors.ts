import type { ActivityStatus, RiskLevel } from "@prisma/client";
import { SECURITY_ALERT_TYPES, type Finding } from "@/lib/security/types";

/**
 * Every detector is a pure function: given already-fetched, narrowly-
 * scoped data, it returns a Finding or null. No detector does its own
 * database I/O — that keeps them fast to unit-test and keeps
 * lib/security/evaluate.ts as the one place responsible for querying
 * only short, indexed windows (spec §55 — never a full-history scan
 * except the one narrow existence check documented below).
 */

// ---------------------------------------------------------------------------
// New sensitive action
// ---------------------------------------------------------------------------

export function detectNewSensitiveAction(params: {
  agentId: string;
  agentName: string;
  action: string;
  riskLevel: RiskLevel;
  status: ActivityStatus;
  traceId: string | null;
  hasPriorHistory: boolean;
}): Finding | null {
  if (params.hasPriorHistory) return null;
  if (params.riskLevel !== "HIGH" && params.riskLevel !== "CRITICAL") return null;

  const isCritical = params.status === "BLOCKED" || params.riskLevel === "CRITICAL";

  return {
    type: SECURITY_ALERT_TYPES.NEW_SENSITIVE_ACTION,
    severity: isCritical ? "CRITICAL" : "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} used a new sensitive action: ${params.action}`,
    description: `This is the first time ${params.agentName} has attempted "${params.action}", and it's a ${params.riskLevel.toLowerCase()}-risk action${
      params.status === "BLOCKED" ? " that was blocked" : ""
    }. First-time use of a sensitive action is worth a quick look — it may be expected (a new integration going live) or it may not be.`,
    evidence: { action: params.action, riskLevel: params.riskLevel, status: params.status },
    traceId: params.traceId,
  };
}

// ---------------------------------------------------------------------------
// Block spike
// ---------------------------------------------------------------------------

const DEFAULT_BLOCK_SPIKE_THRESHOLD = 5;
const DEFAULT_BLOCK_SPIKE_WINDOW_MINUTES = 15;

export function detectBlockSpike(params: {
  agentId: string;
  agentName: string;
  blockedCountInWindow: number;
  windowMinutes?: number;
  threshold?: number;
}): Finding | null {
  const threshold = params.threshold ?? DEFAULT_BLOCK_SPIKE_THRESHOLD;
  const windowMinutes = params.windowMinutes ?? DEFAULT_BLOCK_SPIKE_WINDOW_MINUTES;
  if (params.blockedCountInWindow <= threshold) return null;

  return {
    type: SECURITY_ALERT_TYPES.BLOCK_SPIKE,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} had a spike in blocked actions`,
    description: `${params.blockedCountInWindow} actions were blocked in the last ${windowMinutes} minutes — more than the threshold of ${threshold}. Detected pattern: the agent may be retrying an action it doesn't have permission for, or probing for a working path.`,
    evidence: { blockedCountInWindow: params.blockedCountInWindow, windowMinutes, threshold },
  };
}

// ---------------------------------------------------------------------------
// Failure loop
// ---------------------------------------------------------------------------

const DEFAULT_FAILURE_LOOP_THRESHOLD = 3;
const DEFAULT_FAILURE_LOOP_WINDOW_MINUTES = 5;

export function detectFailureLoop(params: {
  agentId: string;
  agentName: string;
  action: string;
  failureCountInWindow: number;
  windowMinutes?: number;
  threshold?: number;
  traceId?: string | null;
}): Finding | null {
  const threshold = params.threshold ?? DEFAULT_FAILURE_LOOP_THRESHOLD;
  const windowMinutes = params.windowMinutes ?? DEFAULT_FAILURE_LOOP_WINDOW_MINUTES;
  if (params.failureCountInWindow < threshold) return null;

  return {
    type: SECURITY_ALERT_TYPES.FAILURE_LOOP,
    severity: "MEDIUM",
    agentId: params.agentId,
    title: `${params.agentName} is repeatedly failing "${params.action}"`,
    description: `"${params.action}" failed ${params.failureCountInWindow} times in the last ${windowMinutes} minutes. Detected pattern: a retry loop against a failing dependency, or a misconfigured integration — worth checking before it burns further cost or hits a rate limit downstream.`,
    evidence: { action: params.action, failureCountInWindow: params.failureCountInWindow, windowMinutes, threshold },
    traceId: params.traceId,
  };
}

// ---------------------------------------------------------------------------
// New tool usage — approximated by the action's dot-namespace prefix
// (e.g. "crm" in "crm.export"), since ingested events don't carry a
// dedicated tool identifier. Documented honestly rather than implying
// real tool-call instrumentation — see docs/security-intelligence.md.
// ---------------------------------------------------------------------------

export function detectNewToolUsage(params: {
  agentId: string;
  agentName: string;
  action: string;
  hasPriorNamespaceHistory: boolean;
}): Finding | null {
  if (params.hasPriorNamespaceHistory) return null;

  const dotIndex = params.action.indexOf(".");
  const namespace = dotIndex === -1 ? params.action : params.action.slice(0, dotIndex);
  const namespaceLabel = dotIndex === -1 ? `"${namespace}"` : `"${namespace}.*"`;

  return {
    type: SECURITY_ALERT_TYPES.NEW_TOOL_USAGE,
    severity: "LOW",
    agentId: params.agentId,
    title: `${params.agentName} started using "${namespace}" actions`,
    description: `First time this agent has performed a ${namespaceLabel} action. Usually expected when an agent is onboarded to a new tool or integration — flagged here so it's visible, not because it's inherently risky.`,
    evidence: { action: params.action, namespace },
  };
}

// ---------------------------------------------------------------------------
// High-risk burst
// ---------------------------------------------------------------------------

const DEFAULT_HIGH_RISK_BURST_THRESHOLD = 3;
const DEFAULT_HIGH_RISK_BURST_WINDOW_MINUTES = 10;

export function detectHighRiskBurst(params: {
  agentId: string;
  agentName: string;
  highRiskCountInWindow: number;
  windowMinutes?: number;
  threshold?: number;
}): Finding | null {
  const threshold = params.threshold ?? DEFAULT_HIGH_RISK_BURST_THRESHOLD;
  const windowMinutes = params.windowMinutes ?? DEFAULT_HIGH_RISK_BURST_WINDOW_MINUTES;
  if (params.highRiskCountInWindow < threshold) return null;

  return {
    type: SECURITY_ALERT_TYPES.HIGH_RISK_BURST,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} performed a burst of high-risk actions`,
    description: `${params.highRiskCountInWindow} HIGH/CRITICAL-risk actions in the last ${windowMinutes} minutes — more than the threshold of ${threshold}. Detected pattern: a single burst of consequential actions is worth confirming was intentional, especially outside a known batch job.`,
    evidence: { highRiskCountInWindow: params.highRiskCountInWindow, windowMinutes, threshold },
  };
}

// ---------------------------------------------------------------------------
// Cost spike — a cost anomaly is just another security alert type; see
// docs/cost-intelligence.md for why there's no separate anomaly system.
// ---------------------------------------------------------------------------

const DEFAULT_COST_SPIKE_MULTIPLIER = 3;
const DEFAULT_COST_SPIKE_MINIMUM_BASELINE_CENTS = 100; // $1 — avoids flagging trivial spend as a "spike"

export function detectCostSpike(params: {
  agentId: string;
  agentName: string;
  todaySpendCents: number;
  trailingDailyAverageCents: number;
  multiplier?: number;
  minimumBaselineCents?: number;
}): Finding | null {
  const multiplier = params.multiplier ?? DEFAULT_COST_SPIKE_MULTIPLIER;
  const minimumBaseline = params.minimumBaselineCents ?? DEFAULT_COST_SPIKE_MINIMUM_BASELINE_CENTS;

  // No real baseline yet (agent is new or was idle) — nothing to compare against.
  if (params.trailingDailyAverageCents <= 0) return null;
  if (params.todaySpendCents < minimumBaseline) return null;
  if (params.todaySpendCents < params.trailingDailyAverageCents * multiplier) return null;

  const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return {
    type: SECURITY_ALERT_TYPES.COST_SPIKE,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName}'s spend is unusually high today`,
    description: `Normal: ${formatDollars(params.trailingDailyAverageCents)}/day. Today: ${formatDollars(
      params.todaySpendCents
    )} — ${(params.todaySpendCents / params.trailingDailyAverageCents).toFixed(1)}x the trailing average. Likely contributor: a repeated execution loop or an unusually large batch of requests — this is a detected pattern, not a confirmed cause.`,
    evidence: {
      todaySpendCents: params.todaySpendCents,
      trailingDailyAverageCents: params.trailingDailyAverageCents,
      multiplier,
    },
  };
}
