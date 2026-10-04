import type { PolicyDecision, RiskLevel } from "@prisma/client";

import {
  CORROBORATION_MIN_FAMILIES,
  LEVEL_ORDER,
  LEVEL_TO_DECISION,
  RISK_METHODOLOGY_VERSION,
  SEVERITY_ORDER,
  TRUST_STALE_AFTER_MS,
} from "@/lib/risk/config";
import { buildRiskSignals } from "@/lib/risk/signals";
import {
  DECISION_STRICTNESS,
  type RiskAssessment,
  type RiskAssessmentCore,
  type RiskContextNote,
  type RiskFamily,
  type RiskInputs,
  type RiskSignal,
  type ShadowDecision,
} from "@/lib/risk/types";

/**
 * Composition — how signals become one risk level. Three rules, in order:
 *
 *  1. BASE      the level is the most severe signal. (No signals → LOW.)
 *               "As risky as the riskiest evidence" — adding weak evidence
 *               can never lower it, and many weak signals never add up to a
 *               strong one.
 *  2. CORROBORATE  if two or more independent families (policy / request /
 *               behavior / history) each hold a MEDIUM-or-higher signal, the
 *               level rises one step, once. Independent evidence agreeing is
 *               what makes a situation worse than any single piece of it.
 *  3. MAP       level → the decision it argues for (config.LEVEL_TO_DECISION).
 *
 * Pure and deterministic: same inputs, same assessment. The shadow comparison
 * with the real decision is a separate step (buildShadow) because the final
 * decision is only known inside the evaluation transaction.
 */

const SEVERITY_TO_LEVEL: Record<(typeof SEVERITY_ORDER)[number], RiskLevel> = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" };

function stepUp(level: RiskLevel): RiskLevel {
  return LEVEL_ORDER[Math.min(LEVEL_ORDER.indexOf(level) + 1, LEVEL_ORDER.length - 1)];
}

function contextNotes(inputs: RiskInputs): RiskContextNote[] {
  const notes: RiskContextNote[] = [];
  if (!inputs.baseline) {
    notes.push({ code: "baseline_unavailable", summary: "No behavioral baseline exists for this agent yet, so behavior was not compared." });
  } else if (inputs.baseline.maturity === "NEW_AGENT") {
    notes.push({ code: "baseline_new_agent", summary: "This agent is too new for behavioral comparison (baseline maturity NEW_AGENT)." });
  } else if (inputs.baseline.maturity === "LIMITED_HISTORY") {
    notes.push({ code: "baseline_limited_history", summary: "Limited behavioral history: only new-value checks ran, at low confidence." });
  }
  if (!inputs.trust) {
    notes.push({ code: "trust_unavailable", summary: "No trust evaluation exists for this agent yet." });
  } else if (inputs.now.getTime() - inputs.trust.evaluatedAt.getTime() > TRUST_STALE_AFTER_MS) {
    notes.push({ code: "trust_stale", summary: "The agent's stored trust evaluation is more than an hour old." });
  }
  if (inputs.request.dataSensitivity === null) {
    notes.push({ code: "data_classification_not_reported", summary: "The request did not report what kind of data it involves." });
  }
  return notes;
}

function headline(level: RiskLevel, reasons: RiskSignal[], families: RiskFamily[], escalated: boolean): string {
  if (reasons.length === 0) return "LOW RISK — no risk signals.";
  const tail = escalated
    ? `${families.length} independent kinds of evidence agree`
    : `${reasons.length} signal${reasons.length === 1 ? "" : "s"}`;
  return `${level} RISK — ${tail}.`;
}

export function composeRisk(inputs: RiskInputs): RiskAssessmentCore {
  const signals = buildRiskSignals(inputs);

  // Most severe first; ties keep the stable builder order (Array.sort is stable).
  const ordered = [...signals].sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  const reasons = ordered.map((signal, i) => ({ ...signal, rank: i + 1 }));

  const base: RiskLevel = ordered.length ? SEVERITY_TO_LEVEL[ordered[0].severity] : "LOW";
  const corroboratingFamilies = [...new Set(ordered.filter((s) => s.severity !== "LOW").map((s) => s.family))];
  const applied = corroboratingFamilies.length >= CORROBORATION_MIN_FAMILIES;
  const level = applied ? stepUp(base) : base;

  return {
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    level,
    headline: headline(level, ordered, corroboratingFamilies, applied),
    reasons,
    escalation: { applied, corroboratingFamilies, from: base, to: level },
    context: {
      baseline: inputs.baseline
        ? { status: "used", version: inputs.baseline.version, maturity: inputs.baseline.maturity, computedAt: inputs.baseline.computedAt.toISOString() }
        : { status: "unavailable" },
      trust: inputs.trust
        ? { status: "used", state: inputs.trust.state, score: inputs.trust.score, evaluatedAt: inputs.trust.evaluatedAt.toISOString() }
        : { status: "unavailable" },
      notes: contextNotes(inputs),
    },
  };
}

const label = (d: PolicyDecision) => d.replaceAll("_", " ");
const wouldVerb = (d: PolicyDecision) => (d === "ALLOW" ? "ALLOW" : d === "ALERT" ? "ALERT" : d === "REQUIRE_APPROVAL" ? "REQUIRE APPROVAL" : "BLOCK");

/**
 * Compares the risk level's decision with what actually happened. The
 * recommendation is never weaker than the actual decision (the risk engine
 * only ever argues for MORE caution), except that a consumed human approval
 * holds it at `actual`: a person already reviewed this exact request, and a
 * shadow engine that second-guessed that would only teach people to ignore it.
 */
export function buildShadow(params: {
  level: RiskLevel;
  actual: PolicyDecision;
  /** True when the actual decision is ALLOW because a human approval was consumed. */
  humanApproved: boolean;
  /** The organization's configured level → decision mapping (P5); defaults to the P4 mapping. */
  riskDecision?: PolicyDecision;
}): ShadowDecision {
  const { level, actual, humanApproved } = params;
  const riskDecision = params.riskDecision ?? LEVEL_TO_DECISION[level];
  const stricter = DECISION_STRICTNESS[riskDecision] > DECISION_STRICTNESS[actual];

  const recommended: PolicyDecision = stricter && !humanApproved ? riskDecision : actual;
  const suppressedBy = stricter && humanApproved ? ("HUMAN_APPROVAL" as const) : undefined;
  const outcome: ShadowDecision["outcome"] = suppressedBy
    ? "SUPPRESSED"
    : recommended !== actual
      ? "WOULD_ESCALATE"
      : riskDecision === actual
        ? "AGREES"
        : "ACTUAL_STRICTER";

  const summary =
    outcome === "WOULD_ESCALATE"
      ? `Actual: ${label(actual)}. Aegis risk engine: WOULD ${wouldVerb(recommended)}.`
      : suppressedBy
        ? `Actual: ${label(actual)}. Risk alone would ${wouldVerb(riskDecision)}, but a human already approved this exact request.`
        : outcome === "ACTUAL_STRICTER"
          ? `Actual: ${label(actual)}, already stricter than risk alone (${wouldVerb(riskDecision)}).`
          : `Actual: ${label(actual)}. Aegis risk engine agrees.`;

  return { actual, riskDecision, recommended, outcome, ...(suppressedBy ? { suppressedBy } : {}), summary };
}

export function finalizeAssessment(core: RiskAssessmentCore, shadow: ShadowDecision): RiskAssessment {
  return { ...core, shadow };
}

/** Plain-text rendering, for logs, tickets and the dashboard's copy action. */
export function formatAssessment(assessment: RiskAssessment): string {
  const lines = [assessment.headline];
  if (assessment.reasons.length > 0) {
    lines.push("", "Reasons:");
    for (const r of assessment.reasons) lines.push(`${r.rank}. ${r.summary}`);
  }
  if (assessment.escalation.applied) {
    lines.push("", `Escalated ${assessment.escalation.from} → ${assessment.escalation.to}: independent evidence from ${assessment.escalation.corroboratingFamilies.join(", ")} agrees.`);
  }
  for (const n of assessment.context.notes) lines.push(`Note: ${n.summary}`);
  lines.push("", assessment.shadow.summary);
  return lines.join("\n");
}
