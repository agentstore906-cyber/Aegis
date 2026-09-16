import type { ActivityStatus, PolicyDecision, RiskLevel } from "@prisma/client";
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
// New tool usage. When the caller reports a real `toolName` (POST
// /api/v1/events — see lib/activity/ingest.ts), this checks that actual
// identity. Otherwise it falls back to approximating a "tool" from the
// action's dot-namespace prefix (e.g. "crm" in "crm.export"), since not
// every ingestion path carries a dedicated tool identifier — see
// docs/security-intelligence.md.
// ---------------------------------------------------------------------------

export function detectNewToolUsage(params: {
  agentId: string;
  agentName: string;
  action: string;
  toolName?: string | null;
  hasPriorNamespaceHistory: boolean;
  hasPriorToolHistory?: boolean;
}): Finding | null {
  if (params.toolName) {
    if (params.hasPriorToolHistory) return null;
    return {
      type: SECURITY_ALERT_TYPES.NEW_TOOL_USAGE,
      severity: "LOW",
      agentId: params.agentId,
      title: `${params.agentName} started using "${params.toolName}"`,
      description: `First time this agent has used the "${params.toolName}" tool. Usually expected when an agent is onboarded to a new tool or integration — flagged here so it's visible, not because it's inherently risky.`,
      evidence: { action: params.action, tool: params.toolName },
    };
  }

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

// ---------------------------------------------------------------------------
// Activity volume spike — "an agent normally performs 20 actions/hour but
// suddenly performs 500." Same shape as detectCostSpike: today's/this
// hour's count vs. a trailing baseline, not an absolute threshold, so it
// adapts to each agent's own normal volume instead of one fixed number.
// ---------------------------------------------------------------------------

const DEFAULT_VOLUME_SPIKE_MULTIPLIER = 5;
const DEFAULT_VOLUME_SPIKE_MINIMUM_BASELINE = 5; // avoids flagging e.g. 1 action/hour baseline -> 3 this hour as a "5x spike"

export function detectActivityVolumeSpike(params: {
  agentId: string;
  agentName: string;
  actionsThisHour: number;
  trailingHourlyAverage: number;
  multiplier?: number;
  minimumBaseline?: number;
}): Finding | null {
  const multiplier = params.multiplier ?? DEFAULT_VOLUME_SPIKE_MULTIPLIER;
  const minimumBaseline = params.minimumBaseline ?? DEFAULT_VOLUME_SPIKE_MINIMUM_BASELINE;

  // No real baseline yet (agent is new or was idle) — nothing to compare against.
  if (params.trailingHourlyAverage <= 0) return null;
  if (params.actionsThisHour < minimumBaseline) return null;
  if (params.actionsThisHour < params.trailingHourlyAverage * multiplier) return null;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    type: SECURITY_ALERT_TYPES.ACTIVITY_VOLUME_SPIKE,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} had an unusual spike in activity`,
    description: `Normal activity: ~${round(params.trailingHourlyAverage)} actions/hour. This hour: ${
      params.actionsThisHour
    } actions — ${round(params.actionsThisHour / params.trailingHourlyAverage)}x the trailing average. Detected pattern: a runaway loop, a misconfigured trigger, or a real burst of legitimate work — worth confirming it was expected.`,
    evidence: {
      actionsThisHour: params.actionsThisHour,
      trailingHourlyAverage: params.trailingHourlyAverage,
      multiplier,
    },
  };
}

// ---------------------------------------------------------------------------
// Data access spike, delete activity spike, communication spike (Phase 2 —
// Behavioral Intelligence). Same shape as detectCostSpike/
// detectActivityVolumeSpike: today's count of a specific kind of action vs.
// this agent's own trailing 7-day daily average — never a fleet-wide or
// absolute threshold, and never fired without a real baseline to compare
// against (spec: "do not claim a baseline when insufficient data exists").
// ---------------------------------------------------------------------------

const DEFAULT_DATA_ACCESS_SPIKE_MULTIPLIER = 4;
const DEFAULT_DATA_ACCESS_SPIKE_MINIMUM_BASELINE = 5;

export function detectDataAccessSpike(params: {
  agentId: string;
  agentName: string;
  todayCount: number;
  trailingDailyAverage: number;
  multiplier?: number;
  minimumBaseline?: number;
}): Finding | null {
  const multiplier = params.multiplier ?? DEFAULT_DATA_ACCESS_SPIKE_MULTIPLIER;
  const minimumBaseline = params.minimumBaseline ?? DEFAULT_DATA_ACCESS_SPIKE_MINIMUM_BASELINE;

  if (params.trailingDailyAverage <= 0) return null;
  if (params.todayCount < minimumBaseline) return null;
  if (params.todayCount < params.trailingDailyAverage * multiplier) return null;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    type: SECURITY_ALERT_TYPES.DATA_ACCESS_SPIKE,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} had an unusual amount of data access today`,
    description: `Normal: ~${round(params.trailingDailyAverage)} data-access actions/day. Today: ${
      params.todayCount
    } — ${round(params.todayCount / params.trailingDailyAverage)}x the trailing average. Detected pattern: a bulk read/export operation, or a loop re-reading the same records — worth confirming it was expected.`,
    evidence: { todayCount: params.todayCount, trailingDailyAverage: params.trailingDailyAverage, multiplier },
  };
}

const DEFAULT_DELETE_SPIKE_MULTIPLIER = 3;
const DEFAULT_DELETE_SPIKE_MINIMUM_BASELINE = 3;

export function detectDeleteActivitySpike(params: {
  agentId: string;
  agentName: string;
  todayCount: number;
  trailingDailyAverage: number;
  multiplier?: number;
  minimumBaseline?: number;
}): Finding | null {
  const multiplier = params.multiplier ?? DEFAULT_DELETE_SPIKE_MULTIPLIER;
  const minimumBaseline = params.minimumBaseline ?? DEFAULT_DELETE_SPIKE_MINIMUM_BASELINE;

  if (params.trailingDailyAverage <= 0) return null;
  if (params.todayCount < minimumBaseline) return null;
  if (params.todayCount < params.trailingDailyAverage * multiplier) return null;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    type: SECURITY_ALERT_TYPES.DELETE_ACTIVITY_SPIKE,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} had an unusual amount of delete activity today`,
    description: `Normal: ~${round(params.trailingDailyAverage)} destructive (delete-shaped) actions/day. Today: ${
      params.todayCount
    } — ${round(params.todayCount / params.trailingDailyAverage)}x the trailing average. Destructive-action spikes are worth checking before more data is lost, whether that's a runaway cleanup job or a genuine problem.`,
    evidence: { todayCount: params.todayCount, trailingDailyAverage: params.trailingDailyAverage, multiplier },
  };
}

const DEFAULT_COMMUNICATION_SPIKE_MULTIPLIER = 4;
const DEFAULT_COMMUNICATION_SPIKE_MINIMUM_BASELINE = 5;

export function detectExternalCommunicationSpike(params: {
  agentId: string;
  agentName: string;
  todayCount: number;
  trailingDailyAverage: number;
  multiplier?: number;
  minimumBaseline?: number;
}): Finding | null {
  const multiplier = params.multiplier ?? DEFAULT_COMMUNICATION_SPIKE_MULTIPLIER;
  const minimumBaseline = params.minimumBaseline ?? DEFAULT_COMMUNICATION_SPIKE_MINIMUM_BASELINE;

  if (params.trailingDailyAverage <= 0) return null;
  if (params.todayCount < minimumBaseline) return null;
  if (params.todayCount < params.trailingDailyAverage * multiplier) return null;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    type: SECURITY_ALERT_TYPES.COMMUNICATION_SPIKE,
    severity: "MEDIUM",
    agentId: params.agentId,
    title: `${params.agentName} sent an unusual amount of external communication today`,
    description: `Normal: ~${round(params.trailingDailyAverage)} email/message actions/day. Today: ${
      params.todayCount
    } — ${round(params.todayCount / params.trailingDailyAverage)}x the trailing average. A burst of outbound communication is worth a quick look — it may be a legitimate campaign, or a loop sending the same message repeatedly.`,
    evidence: { todayCount: params.todayCount, trailingDailyAverage: params.trailingDailyAverage, multiplier },
  };
}

// ---------------------------------------------------------------------------
// Policy violation, detected after the fact (Phase 8 — Firewall
// truthfulness). Only called for POST /api/v1/events (an agent reporting
// something it already did) — never for the pre-flight /evaluate path,
// which already produces its own authoritative, correctly-worded BLOCK.
// The action already happened; Aegis could not have prevented it, so this
// is always framed as detection, never enforcement. See
// lib/security/evaluate.ts and docs/enforcement.md.
// ---------------------------------------------------------------------------

export function detectPolicyViolationAfterTheFact(params: {
  agentId: string;
  agentName: string;
  action: string;
  resource?: string | null;
  policyDecision: PolicyDecision;
  policyName?: string;
  reason: string;
  traceId?: string | null;
}): Finding | null {
  if (params.policyDecision !== "BLOCK") return null;

  return {
    type: SECURITY_ALERT_TYPES.POLICY_VIOLATION_DETECTED,
    severity: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} already performed an action that violates policy`,
    description: `"${params.action}"${
      params.resource ? ` on "${params.resource}"` : ""
    } was reported as already completed, but ${
      params.policyName ? `the policy "${params.policyName}"` : "an active policy"
    } would have blocked it. Aegis only received this after the fact via event ingestion (not the pre-flight evaluate check) and had no opportunity to prevent it. ${params.reason}`,
    evidence: { action: params.action, resource: params.resource ?? null, policyName: params.policyName ?? null },
    traceId: params.traceId,
    recommendedAction:
      "Review this agent's integration — route this action through the pre-flight /evaluate check so Aegis can act before it happens, not just detect it afterward.",
  };
}

// ---------------------------------------------------------------------------
// Prompt injection indicator (Phase 9 — AI Agent Security). A pure keyword
// heuristic over free-text fields an agent chooses to report (description,
// metadata string values) — Aegis does not have access to an agent's raw
// prompts or model output, only whatever it self-reports. This can never
// be more than an indicator: false positives (e.g. a support agent
// legitimately summarizing a customer's message that happens to contain
// these phrases) are expected, hence LOW confidence and hedged language
// always.
// ---------------------------------------------------------------------------

const PROMPT_INJECTION_PATTERNS = [
  // Tolerates filler words between the verb and its object ("ignore ALL
  // PREVIOUS instructions", not just "ignore instructions").
  /ignore\b[\s\w]{0,30}\b(instructions|prompts?|rules)/i,
  /disregard\b[\s\w]{0,30}\b(instructions|prompts?|system prompt)/i,
  /you are now|new instructions:|system prompt:|act as if you (have no|are not)/i,
  /reveal\b[\s\w]{0,20}\b(system prompt|instructions)/i,
  /do anything now|jailbreak/i,
];

export function detectPromptInjectionIndicator(params: {
  agentId: string;
  agentName: string;
  action: string;
  text: string;
  traceId?: string | null;
}): Finding | null {
  const matched = PROMPT_INJECTION_PATTERNS.find((pattern) => pattern.test(params.text));
  if (!matched) return null;

  return {
    type: SECURITY_ALERT_TYPES.PROMPT_INJECTION_INDICATOR,
    severity: "MEDIUM",
    confidence: "LOW",
    agentId: params.agentId,
    title: `Potential prompt injection detected for ${params.agentName}`,
    description: `Text reported alongside "${params.action}" contains a phrase commonly associated with prompt-injection attempts (e.g. instructions to ignore prior rules). This is a heuristic keyword match, not a confirmed injection — it may be a false positive (e.g. text that legitimately discusses this topic).`,
    evidence: { action: params.action, matchedPattern: matched.source },
    traceId: params.traceId,
    recommendedAction: "Review the source of this input and confirm the agent's actual behavior was not altered.",
  };
}

// ---------------------------------------------------------------------------
// Credential / secret exposure indicator (Phase 9). Fires when an agent's
// self-reported event metadata contained a field shaped like a secret
// (lib/security/redact.ts#findSecretShapedKeyPaths) — the value itself is
// never included in evidence, only the field name. Deterministic (a key
// either matches the pattern or it doesn't), so this is the one heuristic
// detector rated HIGH confidence rather than LOW.
// ---------------------------------------------------------------------------

export function detectCredentialExposureIndicator(params: {
  agentId: string;
  agentName: string;
  action: string;
  secretShapedKeyPaths: string[];
  traceId?: string | null;
}): Finding | null {
  if (params.secretShapedKeyPaths.length === 0) return null;

  return {
    type: SECURITY_ALERT_TYPES.CREDENTIAL_EXPOSURE_DETECTED,
    severity: "CRITICAL",
    confidence: "HIGH",
    agentId: params.agentId,
    title: `${params.agentName} sent a secret-shaped field to Aegis`,
    description: `Event metadata for "${params.action}" included a field (${params.secretShapedKeyPaths
      .map((p) => `"${p}"`)
      .join(", ")}) whose name looks like a credential/token/password/secret. Aegis redacted the value before storing it, but the credential was already sent over the wire and logged wherever the caller's own systems log this request.`,
    evidence: { action: params.action, fieldPaths: params.secretShapedKeyPaths },
    traceId: params.traceId,
    recommendedAction: "Rotate the exposed credential and stop including it in event metadata sent to Aegis.",
  };
}
