import "server-only";

import { prisma } from "@/lib/db";
import { NON_LEARNABLE_STATUSES } from "@/lib/behavior/config";
import { toSnapshot } from "@/lib/behavior/baseline";
import { detectDeviations } from "@/lib/behavior/detect";
import { floorToHour } from "@/lib/behavior/rollup";
import type { EventFeatures } from "@/lib/behavior/types";
import { INCIDENT_QUERY_LIMIT, INCIDENT_WINDOW_DAYS, RISK_CONTEXT_TIMEOUT_MS } from "@/lib/risk/config";
import type { RiskDeviationInput, RiskIncidentInput, RiskInputs, RiskTrustInput } from "@/lib/risk/types";
import type { TrustFactor } from "@/lib/trust/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The slice of RiskInputs that needs the database. */
export type RiskContext = Pick<RiskInputs, "baseline" | "deviations" | "trust" | "incidents" | "incidentsTruncated">;

export type RiskContextRequest = {
  organizationId: string;
  agentId: string;
  action: string;
  eventType: string;
  toolKey: string | null;
  service: string | null;
  destination: string | null;
  dataClasses: string[];
  endUserHash: string | null;
  recordCount: number | null;
  byteCount: number | null;
  parentEventId: string | null;
  now: Date;
};

/**
 * Loads everything the risk engine needs from stored evidence. READ-ONLY and
 * tenant-scoped: every query filters on organizationId AND agentId, so a
 * mismatched pair (another tenant's agent) reads nothing. Unlike the
 * after-the-fact behavior observer it never computes or writes a baseline —
 * this runs on the decision path, so it uses the latest baseline already
 * stored and reports its absence as missing context.
 */
export async function loadRiskContext(req: RiskContextRequest): Promise<RiskContext> {
  const { organizationId, agentId, now } = req;
  const hourStart = floorToHour(now);
  const incidentSince = new Date(now.getTime() - INCIDENT_WINDOW_DAYS * DAY_MS);

  const [baselineRow, trustRow, parent, hourCount, evaluations, rejected] = await Promise.all([
    prisma.agentBaseline.findFirst({
      where: { agentId, organizationId },
      orderBy: { version: "desc" },
      select: { version: true, maturity: true, profile: true, computedAt: true },
    }),
    prisma.agentTrustState.findFirst({ where: { agentId, organizationId } }),
    req.parentEventId
      ? prisma.activityEvent.findFirst({ where: { id: req.parentEventId, organizationId }, select: { action: true } })
      : Promise.resolve(null),
    prisma.activityEvent.count({
      where: {
        organizationId,
        agentId,
        timestamp: { gte: hourStart, lt: new Date(hourStart.getTime() + HOUR_MS) },
        status: { notIn: [...NON_LEARNABLE_STATUSES] },
      },
    }),
    // Same grain as P3 trust: BLOCK/ALERT. Kill-switch refusals aren't agent behavior and risk-control gates
    // would make risk feed itself (a gated request becoming "history" that gates the next one).
    prisma.policyEvaluation.findMany({
      where: {
        organizationId,
        agentId,
        action: req.action,
        decision: { in: ["BLOCK", "ALERT"] },
        createdAt: { gte: incidentSince },
        OR: [{ decisionSource: null }, { decisionSource: { notIn: ["CONTROL", "RISK"] } }],
      },
      orderBy: { createdAt: "desc" },
      take: INCIDENT_QUERY_LIMIT,
      select: { id: true, decision: true, createdAt: true },
    }),
    prisma.approvalRequest.findMany({
      where: { organizationId, agentId, action: req.action, status: "REJECTED", resolvedAt: { gte: incidentSince } },
      orderBy: { resolvedAt: "desc" },
      take: INCIDENT_QUERY_LIMIT,
      select: { id: true, resolvedAt: true },
    }),
  ]);

  const baseline = baselineRow
    ? { version: baselineRow.version, maturity: baselineRow.maturity, computedAt: baselineRow.computedAt }
    : null;

  // Dry-run the SAME detectors that later record deviations for this event
  // (lib/behavior/detect.ts) — nothing is written here. The current hour
  // counts this request as one more learnable event.
  let deviations: RiskDeviationInput[] = [];
  if (baselineRow) {
    const features: EventFeatures = {
      eventId: "pending",
      timestamp: now,
      eventType: req.eventType,
      toolKey: req.toolKey,
      service: req.service,
      destination: req.destination,
      dataClasses: req.dataClasses,
      endUserHash: req.endUserHash,
      recordCount: req.recordCount,
      byteCount: req.byteCount,
      transition: parent ? `${parent.action}>${req.action}` : null,
    };
    deviations = detectDeviations(toSnapshot(baselineRow), features, hourCount + 1).map((d) => ({
      kind: d.kind,
      dedupeKey: d.dedupeKey,
      confidence: d.confidence,
      observed: d.observed,
      expected: d.expected,
      explanation: d.explanation,
    }));
  }

  const trust: RiskTrustInput | null = trustRow
    ? {
        state: trustRow.state,
        score: trustRow.score,
        evaluatedAt: trustRow.evaluatedAt,
        factors: ((trustRow.factors as unknown as TrustFactor[]) ?? []).map((f) => ({ code: f.code, summary: f.summary, points: f.points })),
      }
    : null;

  const incidents: RiskIncidentInput[] = [
    ...evaluations.map((e) => ({ type: "policy_evaluation" as const, id: e.id, at: e.createdAt, outcome: e.decision })),
    ...rejected.flatMap((a) => (a.resolvedAt ? [{ type: "approval_request" as const, id: a.id, at: a.resolvedAt, outcome: "REJECTED" }] : [])),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    baseline,
    deviations,
    trust,
    incidents,
    incidentsTruncated: evaluations.length >= INCIDENT_QUERY_LIMIT || rejected.length >= INCIDENT_QUERY_LIMIT,
  };
}

/**
 * Starts loading risk context immediately and never rejects: a failure or a
 * timeout resolves to null (logged), because risk assessment is advisory in
 * P4 and must not be able to delay or fail an authorization decision.
 */
export function startRiskContext(req: RiskContextRequest, timeoutMs = RISK_CONTEXT_TIMEOUT_MS): Promise<RiskContext | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.error(JSON.stringify({ msg: "risk_context_timeout", agentId: req.agentId, timeoutMs }));
      resolve(null);
    }, timeoutMs);
  });
  const load = loadRiskContext(req).catch((error: unknown) => {
    console.error(JSON.stringify({ msg: "risk_context_failed", agentId: req.agentId, error: String(error) }));
    return null;
  });
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer));
}
