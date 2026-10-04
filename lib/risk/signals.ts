import {
  ACTION_RULE_SEVERITY,
  CONFIDENCE_CEILING,
  DEVIATION_SEVERITY,
  INCIDENT_REPEAT_MIN,
  INCIDENT_WINDOW_DAYS,
  MAX_EVIDENCE_PER_REASON,
  SENSITIVITY_SEVERITY,
  SEVERITY_ORDER,
  TRUST_SEVERITY,
} from "@/lib/risk/config";
import type { RiskDeviationInput, RiskInputs, RiskSignal, SignalSeverity } from "@/lib/risk/types";

/**
 * Turns the facts gathered for one request into risk signals. Pure and
 * deterministic: each builder reads only its slice of RiskInputs and emits a
 * signal only when the telemetry actually shows something. A missing input
 * produces NO signal (and a context note elsewhere) — never a made-up one.
 */

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const rank = (s: SignalSeverity) => SEVERITY_ORDER.indexOf(s);
const minSeverity = (a: SignalSeverity, b: SignalSeverity) => (rank(a) <= rank(b) ? a : b);

function policySignals({ policy }: RiskInputs): RiskSignal[] {
  // Only an explicit rule's verdict is a "violation". REQUIRE_APPROVAL is a
  // review gate, and default-deny is the absence of a rule — neither is
  // evidence of misbehavior, and both are already enforced.
  if (!policy.explicitRuleMatched) return [];
  if (policy.policyDecision !== "ALERT" && policy.policyDecision !== "BLOCK") return [];

  const rule = policy.winningPolicy
    ? { source: "policy" as const, ref: policy.winningPolicy.id, detail: { name: policy.winningPolicy.name, decision: policy.winningPolicy.decision, severity: policy.winningPolicy.severity } }
    : policy.matchedPermission
      ? { source: "permission" as const, ref: policy.matchedPermission.id, detail: { action: policy.matchedPermission.action, decision: policy.matchedPermission.decision } }
      : null;
  if (!rule) return [];

  const severity: SignalSeverity =
    policy.policyDecision === "BLOCK"
      ? "HIGH"
      : policy.winningPolicy?.severity === "CRITICAL"
        ? "HIGH"
        : ((policy.winningPolicy?.severity ?? "MEDIUM") as SignalSeverity);
  const name = policy.winningPolicy ? `policy "${policy.winningPolicy.name}"` : "an agent permission";
  return [
    {
      code: "policy_violation",
      family: "policy",
      severity,
      summary: `Policy violation: ${name} resolves this action to ${policy.policyDecision}.`,
      evidence: [rule],
    },
  ];
}

function requestSignals({ request, action }: RiskInputs): RiskSignal[] {
  const out: RiskSignal[] = [];

  const sensitivity = request.dataSensitivity ? SENSITIVITY_SEVERITY[request.dataSensitivity] : undefined;
  if (sensitivity) {
    out.push({
      code: "sensitive_data",
      family: "request",
      severity: sensitivity,
      summary: `Sensitive data: this request involves ${request.dataSensitivity} sensitivity data${request.dataClasses.length ? ` (${request.dataClasses.join(", ")})` : ""}.`,
      evidence: [{ source: "request", detail: { dataSensitivity: request.dataSensitivity, dataClasses: request.dataClasses } }],
    });
  }

  const actionSeverity = request.scoredRule ? ACTION_RULE_SEVERITY[request.scoredLevel] : undefined;
  if (actionSeverity && request.scoredRule) {
    out.push({
      code: "high_risk_action",
      family: "request",
      severity: actionSeverity,
      summary: `High-risk action: "${action}" matches the ${request.scoredRule.replaceAll("_", " ")} rule (${request.scoredLevel}).`,
      evidence: [{ source: "request", detail: { rule: request.scoredRule, level: request.scoredLevel, action } }],
    });
  }
  return out;
}

function deviationSummary(d: RiskDeviationInput): string {
  const observed = d.observed;
  switch (d.kind) {
    case "NEW_DESTINATION":
      return `New destination: "${String(observed.value)}" was not part of this agent's normal destinations.`;
    case "UNUSUAL_VOLUME": {
      const ratio = typeof observed.ratioToP95 === "number" ? `${fmt(observed.ratioToP95)}× its 95th percentile` : "above its normal range";
      return `Unusual volume: ${fmt(Number(observed.value))} ${String(observed.unit)} — ${ratio}.`;
    }
    case "UNUSUAL_SEQUENCE":
      return `Unusual sequence: "${String(observed.value)}" has not occurred in this agent's history.`;
    case "NEW_TOOL":
      return `New tool: "${String(observed.value)}" is not one this agent normally uses.`;
    case "UNUSUAL_DATA_TYPE":
      return `Unusual data type: "${String(observed.value)}" is not data this agent normally handles.`;
    case "NEW_SERVICE":
      return `New service: "${String(observed.value)}" is not one this agent normally uses.`;
    case "NEW_ACTION_TYPE":
      return `New action type: "${String(observed.value)}" is not one this agent normally performs.`;
    case "NEW_END_USER":
      return "New end user: this agent served an end user it has not served before.";
    case "UNUSUAL_FREQUENCY":
      return `Unusual frequency: ${fmt(Number(observed.events))} events this hour, above its normal range.`;
    case "UNUSUAL_TIME":
      return `Unusual time: activity at ${String(observed.hourOfDayUtc).padStart(2, "0")}:00 UTC, an hour this agent is never active.`;
    default:
      return `Behavioral deviation (${d.kind}).`;
  }
}

function behaviorSignals({ deviations, baseline }: RiskInputs): RiskSignal[] {
  return deviations.map((d) => {
    const base = DEVIATION_SEVERITY[d.kind] ?? "LOW";
    const severity = minSeverity(base, CONFIDENCE_CEILING[d.confidence]);
    const code =
      d.kind === "NEW_DESTINATION"
        ? "new_destination"
        : d.kind === "UNUSUAL_VOLUME"
          ? "unusual_volume"
          : d.kind === "UNUSUAL_SEQUENCE"
            ? "unusual_sequence"
            : "behavioral_deviation";
    return {
      code,
      family: "behavior",
      severity,
      summary: deviationSummary(d),
      evidence: [
        {
          source: "behavioral_deviation" as const,
          detail: {
            kind: d.kind,
            confidence: d.confidence,
            observed: d.observed,
            expected: d.expected,
            explanation: d.explanation,
            baselineVersion: baseline?.version ?? null,
            baselineMaturity: baseline?.maturity ?? null,
          },
        },
      ],
    } satisfies RiskSignal;
  });
}

function historySignals({ trust, incidents, incidentsTruncated, action }: RiskInputs): RiskSignal[] {
  const out: RiskSignal[] = [];

  const trustSeverity = trust ? TRUST_SEVERITY[trust.state] : undefined;
  if (trust && trustSeverity) {
    out.push({
      code: "trust_degradation",
      family: "history",
      severity: trustSeverity,
      summary: `Agent trust degraded: ${trust.state.replaceAll("_", " ")} (score ${trust.score}/100).`,
      evidence: [
        {
          source: "trust_state",
          detail: {
            state: trust.state,
            score: trust.score,
            evaluatedAt: trust.evaluatedAt.toISOString(),
            topFactors: trust.factors.slice(0, 3),
          },
        },
      ],
    });
  }

  if (incidents.length > 0) {
    const count = incidents.length;
    const severity: SignalSeverity = count >= INCIDENT_REPEAT_MIN ? "MEDIUM" : "LOW";
    out.push({
      code: "historical_incident",
      family: "history",
      severity,
      summary: `Historical incident: "${action}" was blocked, alerted or rejected ${incidentsTruncated ? "at least " : ""}${count} time${count === 1 ? "" : "s"} for this agent in the last ${INCIDENT_WINDOW_DAYS} days.`,
      evidence: incidents.slice(0, MAX_EVIDENCE_PER_REASON).map((i) => ({
        source: i.type,
        ref: i.id,
        detail: { outcome: i.outcome, at: i.at.toISOString() },
      })),
    });
  }
  return out;
}

/** All signals for one request, in a stable order (policy, request, behavior, history). */
export function buildRiskSignals(inputs: RiskInputs): RiskSignal[] {
  return [...policySignals(inputs), ...requestSignals(inputs), ...behaviorSignals(inputs), ...historySignals(inputs)];
}
