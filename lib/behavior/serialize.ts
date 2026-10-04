import type { BehavioralDeviation } from "@prisma/client";

/** API shape of a deviation — ids, explanation, and the observed/expected evidence; no internal fields. */
export function serializeDeviation(d: BehavioralDeviation) {
  return {
    id: d.id,
    kind: d.kind,
    subject: d.dedupeKey,
    day: d.day.toISOString().slice(0, 10),
    confidence: d.confidence,
    maturity: d.maturity,
    baselineVersion: d.baselineVersion,
    explanation: d.explanation,
    observed: d.observed,
    expected: d.expected,
    eventId: d.eventId,
    occurrences: d.occurrences,
    firstSeenAt: d.firstSeenAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  };
}
