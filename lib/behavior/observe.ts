import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { NON_LEARNABLE_STATUSES } from "@/lib/behavior/config";
import { ensureBaseline, toSnapshot } from "@/lib/behavior/baseline";
import { detectDeviations } from "@/lib/behavior/detect";
import { floorToHour, startOfUtcDay } from "@/lib/behavior/rollup";
import type { DeviationCandidate, EventFeatures } from "@/lib/behavior/types";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Compares one recorded event with its agent's baseline and records any
 * deviations. Runs AFTER the response (scheduled via lib/server/defer.ts from
 * ingestion and evaluation) — behavioral memory never sits on the decision
 * path and, in P2, never changes a decision or raises an alert.
 *
 * Deviations are de-duplicated per (agent, kind, subject, UTC day): the first
 * occurrence's explanation is kept verbatim; repeats only advance
 * `occurrences`/`lastSeenAt`.
 */
export async function observeEventBehavior(
  organizationId: string,
  agentId: string,
  eventId: string,
  now = new Date()
): Promise<DeviationCandidate[]> {
  const event = await prisma.activityEvent.findFirst({
    where: { id: eventId, organizationId, agentId },
    select: {
      id: true,
      timestamp: true,
      eventType: true,
      action: true,
      toolKey: true,
      service: true,
      destination: true,
      dataClasses: true,
      endUserHash: true,
      recordCount: true,
      byteCount: true,
      parent: { select: { action: true, organizationId: true } },
    },
  });
  if (!event) return [];

  const baseline = await ensureBaseline(organizationId, agentId, now);
  const snapshot = toSnapshot(baseline);
  if (snapshot.maturity === "NEW_AGENT") return [];

  const hourStart = floorToHour(event.timestamp);
  const currentHourCount = await prisma.activityEvent.count({
    where: {
      organizationId,
      agentId,
      timestamp: { gte: hourStart, lt: new Date(hourStart.getTime() + HOUR_MS) },
      status: { notIn: [...NON_LEARNABLE_STATUSES] },
    },
  });

  const features: EventFeatures = {
    eventId: event.id,
    timestamp: event.timestamp,
    eventType: event.eventType,
    toolKey: event.toolKey,
    service: event.service,
    destination: event.destination,
    dataClasses: event.dataClasses,
    endUserHash: event.endUserHash,
    recordCount: event.recordCount,
    byteCount: event.byteCount,
    transition: event.parent && event.parent.organizationId === organizationId ? `${event.parent.action}>${event.action}` : null,
  };

  const candidates = detectDeviations(snapshot, features, currentHourCount);
  const day = startOfUtcDay(event.timestamp);
  for (const candidate of candidates) {
    await recordDeviation({ organizationId, agentId, eventId: event.id, day, now, baseline: snapshot, candidate });
  }
  return candidates;
}

async function recordDeviation(params: {
  organizationId: string;
  agentId: string;
  eventId: string;
  day: Date;
  now: Date;
  baseline: { version: number; maturity: "NEW_AGENT" | "LIMITED_HISTORY" | "ESTABLISHED" };
  candidate: DeviationCandidate;
}) {
  const { organizationId, agentId, eventId, day, now, baseline, candidate } = params;
  const where = { agentId_kind_dedupeKey_day: { agentId, kind: candidate.kind, dedupeKey: candidate.dedupeKey, day } };
  const repeat = { occurrences: { increment: 1 }, lastSeenAt: now };
  try {
    await prisma.behavioralDeviation.upsert({
      where,
      create: {
        organizationId,
        agentId,
        kind: candidate.kind,
        dedupeKey: candidate.dedupeKey,
        day,
        baselineVersion: baseline.version,
        maturity: baseline.maturity,
        confidence: candidate.confidence,
        eventId,
        observed: candidate.observed as Prisma.InputJsonValue,
        expected: candidate.expected as Prisma.InputJsonValue,
        explanation: candidate.explanation,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: repeat,
    });
  } catch (error) {
    // Two concurrent first occurrences: the loser just counts as a repeat.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await prisma.behavioralDeviation.update({ where, data: repeat });
      return;
    }
    throw error;
  }
}
