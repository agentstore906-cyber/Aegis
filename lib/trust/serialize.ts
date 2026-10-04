import type { AgentTrustTransition } from "@prisma/client";

import { TRUST_STATE_ORDER, TRUST_THRESHOLDS } from "@/lib/trust/config";
import type { TrustView } from "@/lib/trust/queries";

export function serializeTrust(view: TrustView) {
  return {
    state: view.state,
    score: view.score,
    stateSince: view.stateSince.toISOString(),
    evaluatedAt: view.evaluatedAt.toISOString(),
    methodologyVersion: view.methodologyVersion,
    headline: view.headline,
  };
}

export function serializeReasons(view: TrustView) {
  return {
    state: view.state,
    score: view.score,
    evidenceScore: view.evidenceScore,
    evaluatedAt: view.evaluatedAt.toISOString(),
    methodologyVersion: view.methodologyVersion,
    headline: view.headline,
    factors: view.factors,
    omittedFactors: view.omittedFactors,
    limits: view.limits,
    categories: view.categories,
    thresholds: TRUST_STATE_ORDER.map((state) => ({ state, minScore: TRUST_THRESHOLDS[state].min })),
  };
}

function direction(t: AgentTrustTransition): "initialized" | "degraded" | "recovered" | "shifted" {
  if (t.previousScore === null || t.previousState === null) return "initialized";
  const worse = TRUST_STATE_ORDER.indexOf(t.newState) - TRUST_STATE_ORDER.indexOf(t.previousState);
  if (t.newScore < t.previousScore || worse > 0) return "degraded";
  if (t.newScore > t.previousScore || worse < 0) return "recovered";
  return "shifted";
}

export function serializeTransition(t: AgentTrustTransition) {
  return {
    sequence: t.sequence,
    occurredAt: t.occurredAt.toISOString(),
    direction: direction(t),
    previousState: t.previousState,
    newState: t.newState,
    previousScore: t.previousScore,
    newScore: t.newScore,
    trigger: t.trigger,
    triggerRef: t.triggerRef,
    summary: t.summary,
    factors: t.factors,
    limits: t.limits,
    changes: t.changes,
    methodologyVersion: t.methodologyVersion,
  };
}
