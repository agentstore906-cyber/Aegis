import "server-only";

import type { PolicyDecision, RiskLevel, RiskReviewLabelValue } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

/**
 * Shadow analytics (P5). Everything here is a count of recorded decisions,
 * scoped to one organization. Nothing is estimated.
 *
 * What these numbers are NOT: a precision or false-positive rate. Aegis has no
 * ground truth for "should this have been stopped" — the only source is an
 * operator's review label (RiskReviewLabel). A rate is reported only when
 * enough labels exist, with its sample size, and it is always described as the
 * share of REVIEWED decisions, never of all decisions.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fewer labeled decisions than this and no rate is shown at all. */
export const MIN_LABELS_FOR_RATE = 30;
/** Rows read for the top-reasons breakdown, newest first, so the query cost is bounded. */
const TOP_REASONS_ROW_LIMIT = 20_000;

export type RiskAnalytics = {
  windowDays: number;
  since: string;
  evaluations: number;
  /** Evaluations that carry a risk assessment (older rows and unavailable assessments do not). */
  assessed: number;
  byLevel: Record<RiskLevel, number>;
  shadow: {
    /** Risk's configured mapping would have been stricter than what actually happened. */
    wouldHaveBlocked: number;
    wouldHaveRequiredApproval: number;
    wouldHaveAlerted: number;
    agrees: number;
    actualStricter: number;
    suppressedByApproval: number;
  };
  enforcement: {
    observed: number;
    noChange: number;
    /** Risk made the returned decision stricter than policy alone. */
    escalated: { total: number; blocked: number; requiredApproval: number; alerted: number };
    approvalHonored: number;
    unavailable: number;
    killSwitch: number;
  };
  topReasons: { code: string; family: string; decisions: number; agents: number }[];
  review: {
    /** Decisions where risk disagreed with (or changed) the outcome — the ones worth a human look. */
    reviewable: number;
    labeled: number;
    justified: number;
    falsePositive: number;
    unsure: number;
    unlabeled: number;
    /** Null until MIN_LABELS_FOR_RATE decided (justified + false positive) labels exist. */
    falsePositiveShareOfReviewed: { value: number; n: number } | null;
    note: string;
  };
};

const REVIEWABLE_WHERE = {
  OR: [{ riskShadowOutcome: "WOULD_ESCALATE" }, { riskControlOutcome: { in: ["ESCALATED", "APPROVAL_HONORED"] } }],
};

export async function getRiskAnalytics(organizationId: string, options: { days?: number; now?: Date } = {}): Promise<RiskAnalytics> {
  const windowDays = Math.min(Math.max(options.days ?? 14, 1), 90);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const base = { organizationId, createdAt: { gte: since } };

  const [evaluations, assessed, levels, shadowRows, controlRows, escalatedRows, reasons, reviewable, labels] = await Promise.all([
    prisma.policyEvaluation.count({ where: base }),
    prisma.policyEvaluation.count({ where: { ...base, riskAssessedLevel: { not: null } } }),
    prisma.policyEvaluation.groupBy({ by: ["riskAssessedLevel"], where: { ...base, riskAssessedLevel: { not: null } }, _count: { _all: true } }),
    prisma.policyEvaluation.groupBy({
      by: ["riskShadowOutcome", "riskRecommendedDecision"],
      where: { ...base, riskShadowOutcome: { not: null } },
      _count: { _all: true },
    }),
    prisma.policyEvaluation.groupBy({ by: ["riskControlOutcome"], where: { ...base, riskControlOutcome: { not: null } }, _count: { _all: true } }),
    prisma.policyEvaluation.groupBy({ by: ["decision"], where: { ...base, riskControlOutcome: "ESCALATED" }, _count: { _all: true } }),
    prisma.$queryRaw<{ code: string; family: string; decisions: number; agents: number }[]>`
      SELECT r->>'code' AS code, r->>'family' AS family,
             COUNT(*)::int AS decisions, COUNT(DISTINCT e."agentId")::int AS agents
        FROM (
          SELECT "agentId", "riskAssessment"
            FROM "policy_evaluations"
           WHERE "organizationId" = ${organizationId}
             AND "createdAt" >= ${since.toISOString()}::timestamp
             AND ("riskShadowOutcome" = 'WOULD_ESCALATE' OR "riskControlOutcome" IN ('ESCALATED', 'APPROVAL_HONORED'))
           ORDER BY "createdAt" DESC
           LIMIT ${TOP_REASONS_ROW_LIMIT}
        ) e
        CROSS JOIN LATERAL jsonb_array_elements(e."riskAssessment"->'reasons') AS r
       GROUP BY 1, 2
       ORDER BY decisions DESC, code ASC
       LIMIT 10`,
    prisma.policyEvaluation.count({ where: { ...base, ...REVIEWABLE_WHERE } }),
    prisma.riskReviewLabel.groupBy({
      by: ["label"],
      where: { organizationId, evaluation: { is: { createdAt: { gte: since } } } },
      _count: { _all: true },
    }),
  ]);

  const byLevel: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const row of levels) if (row.riskAssessedLevel) byLevel[row.riskAssessedLevel] = row._count._all;

  const shadow = { wouldHaveBlocked: 0, wouldHaveRequiredApproval: 0, wouldHaveAlerted: 0, agrees: 0, actualStricter: 0, suppressedByApproval: 0 };
  for (const row of shadowRows) {
    const n = row._count._all;
    if (row.riskShadowOutcome === "WOULD_ESCALATE") {
      if (row.riskRecommendedDecision === "BLOCK") shadow.wouldHaveBlocked += n;
      else if (row.riskRecommendedDecision === "REQUIRE_APPROVAL") shadow.wouldHaveRequiredApproval += n;
      else if (row.riskRecommendedDecision === "ALERT") shadow.wouldHaveAlerted += n;
    } else if (row.riskShadowOutcome === "AGREES") shadow.agrees += n;
    else if (row.riskShadowOutcome === "ACTUAL_STRICTER") shadow.actualStricter += n;
    else if (row.riskShadowOutcome === "SUPPRESSED") shadow.suppressedByApproval += n;
  }

  const control: Record<string, number> = {};
  for (const row of controlRows) if (row.riskControlOutcome) control[row.riskControlOutcome] = row._count._all;
  const escalatedBy = (d: PolicyDecision) => escalatedRows.find((r) => r.decision === d)?._count._all ?? 0;

  const labelCount = (l: RiskReviewLabelValue) => labels.find((x) => x.label === l)?._count._all ?? 0;
  const justified = labelCount("JUSTIFIED");
  const falsePositive = labelCount("FALSE_POSITIVE");
  const unsure = labelCount("UNSURE");
  const labeled = justified + falsePositive + unsure;
  const decided = justified + falsePositive;

  return {
    windowDays,
    since: since.toISOString(),
    evaluations,
    assessed,
    byLevel,
    shadow,
    enforcement: {
      observed: control.OBSERVED ?? 0,
      noChange: control.NO_CHANGE ?? 0,
      escalated: {
        total: control.ESCALATED ?? 0,
        blocked: escalatedBy("BLOCK"),
        requiredApproval: escalatedBy("REQUIRE_APPROVAL"),
        alerted: escalatedBy("ALERT"),
      },
      approvalHonored: control.APPROVAL_HONORED ?? 0,
      unavailable: control.UNAVAILABLE ?? 0,
      killSwitch: control.KILL_SWITCH ?? 0,
    },
    topReasons: reasons,
    review: {
      reviewable,
      labeled,
      justified,
      falsePositive,
      unsure,
      unlabeled: Math.max(reviewable - labeled, 0),
      falsePositiveShareOfReviewed: decided >= MIN_LABELS_FOR_RATE ? { value: falsePositive / decided, n: decided } : null,
      note:
        "There is no ground truth for 'should this have been stopped'. These figures are operator review labels only: " +
        "the share is of REVIEWED decisions (not of all decisions), reviewers choose what to review so the sample is not random, " +
        `and no share is shown until ${MIN_LABELS_FOR_RATE} justified/false-positive labels exist.`,
    },
  };
}

export type ReviewQueueItem = {
  evaluationId: string;
  createdAt: Date;
  action: string;
  agent: { id: string; name: string; slug: string };
  decision: PolicyDecision;
  recommended: PolicyDecision | null;
  level: RiskLevel | null;
  outcome: string | null;
  headline: string | null;
  label: RiskReviewLabelValue | null;
  note: string | null;
};

/** Decisions where risk disagreed with, or changed, the outcome — newest first. */
export async function listReviewQueue(
  organizationId: string,
  options: { days?: number; limit?: number; unlabeledOnly?: boolean; now?: Date } = {}
): Promise<ReviewQueueItem[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - Math.min(Math.max(options.days ?? 14, 1), 90) * DAY_MS);
  const rows = await prisma.policyEvaluation.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      ...REVIEWABLE_WHERE,
      ...(options.unlabeledOnly ? { riskReviewLabel: { is: null } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 25, 1), 100),
    include: { agent: { select: { id: true, name: true, slug: true } }, riskReviewLabel: true },
  });
  return rows.map((r) => ({
    evaluationId: r.id,
    createdAt: r.createdAt,
    action: r.action,
    agent: r.agent,
    decision: r.decision,
    recommended: r.riskRecommendedDecision,
    level: r.riskAssessedLevel,
    outcome: r.riskControlOutcome,
    headline: (r.riskAssessment as { headline?: string } | null)?.headline ?? null,
    label: r.riskReviewLabel?.label ?? null,
    note: r.riskReviewLabel?.note ?? null,
  }));
}

export type LabelResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "NOT_REVIEWABLE" };

/** Records (or replaces) an operator's judgement about one risk-flagged decision. Tenant-scoped. */
export async function labelRiskDecision(params: {
  organizationId: string;
  evaluationId: string;
  reviewerId: string;
  label: RiskReviewLabelValue;
  note?: string;
}): Promise<LabelResult> {
  const { organizationId, evaluationId, reviewerId, label } = params;
  const note = params.note?.trim().slice(0, 500) || null;
  return prisma.$transaction(async (tx) => {
    const evaluation = await tx.policyEvaluation.findFirst({
      where: { id: evaluationId, organizationId },
      select: { id: true, riskAssessedLevel: true, riskShadowOutcome: true, riskControlOutcome: true },
    });
    if (!evaluation) return { ok: false as const, error: "NOT_FOUND" as const };
    if (!evaluation.riskAssessedLevel) return { ok: false as const, error: "NOT_REVIEWABLE" as const };

    const previous = await tx.riskReviewLabel.findUnique({ where: { evaluationId } });
    await tx.riskReviewLabel.upsert({
      where: { evaluationId },
      create: { organizationId, evaluationId, label, note, reviewedById: reviewerId },
      update: { label, note, reviewedById: reviewerId },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorType: "USER",
      actorUserId: reviewerId,
      eventType: AUDIT_EVENT_TYPES.RISK_CONTROL_REVIEWED,
      entityType: "PolicyEvaluation",
      entityId: evaluationId,
      action: "risk_control.review",
      metadata: { label, previousLabel: previous?.label ?? null },
    });
    return { ok: true as const };
  });
}
