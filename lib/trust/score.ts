import type { BehavioralDeviationKind, TrustState } from "@prisma/client";

import {
  ALERT_SEVERITY_POINTS,
  ALERT_STATUS_MULTIPLIER,
  BLOCK_POINTS,
  CONFIDENCE_MULTIPLIER,
  DEVIATION_POINTS,
  DEVIATION_REPEAT,
  REJECTED_APPROVAL_POINTS,
  TRUST_CATEGORIES,
  TRUST_HISTORY_REQUIREMENT,
  TRUST_MAX_FACTORS,
  TRUST_MIN_SCORE_DELTA,
  TRUST_RECOVERY_MARGIN,
  TRUST_STATE_ORDER,
  TRUST_THRESHOLDS,
  VIOLATION_POINTS,
  type TrustCategoryName,
} from "@/lib/trust/config";
import type {
  TrustCategoryTotal,
  TrustChange,
  TrustEvidence,
  TrustFactor,
  TrustLimit,
  TrustResult,
  TrustSnapshot,
  TrustTransitionDescription,
} from "@/lib/trust/types";

/**
 * Pure trust computation (P3). No I/O, no clock: everything depends on the
 * evidence and `now`, so every number in an explanation is reproducible
 * from the inputs (and unit-testable without a database).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export const STATE_LABEL: Record<TrustState, string> = {
  TRUSTED: "Trusted",
  NORMAL: "Normal",
  DEGRADED: "Degraded",
  HIGH_RISK: "High risk",
  RESTRICTED: "Restricted",
};

const rank = (state: TrustState) => TRUST_STATE_ORDER.indexOf(state);

/** Evidence strength by age: 1 now, linearly down to 0 at the end of its window. */
export function decay(at: Date, now: Date, windowMs: number): number {
  const age = now.getTime() - at.getTime();
  if (age <= 0) return 1;
  return Math.max(0, 1 - age / windowMs);
}

/**
 * State for a score. Moving to a better state than `previous` needs the
 * threshold plus TRUST_RECOVERY_MARGIN (hysteresis); worse or equal states
 * use the plain threshold.
 */
export function stateForScore(score: number, previous: TrustState | null): TrustState {
  for (const state of TRUST_STATE_ORDER) {
    const margin = previous !== null && rank(state) < rank(previous) ? TRUST_RECOVERY_MARGIN : 0;
    if (score >= TRUST_THRESHOLDS[state].min + margin) return state;
  }
  return "RESTRICTED";
}

const DEVIATION_LABEL: Record<BehavioralDeviationKind, string> = {
  NEW_DESTINATION: "New destination",
  UNUSUAL_DATA_TYPE: "Unusual data type",
  UNUSUAL_VOLUME: "Unusual data volume",
  UNUSUAL_SEQUENCE: "Unusual action sequence",
  NEW_TOOL: "New tool",
  UNUSUAL_FREQUENCY: "Unusual activity frequency",
  NEW_SERVICE: "New service",
  NEW_ACTION_TYPE: "New action type",
  UNUSUAL_TIME: "Activity at an unusual hour",
  NEW_END_USER: "New end user",
};

/** "destination:api.x.com" -> "api.x.com"; rule keys without a value (volume:records, hourOfDay:3) read as a qualifier. */
function deviationSubject(kind: BehavioralDeviationKind, dedupeKey: string): string {
  const value = dedupeKey.slice(dedupeKey.indexOf(":") + 1);
  switch (kind) {
    case "UNUSUAL_VOLUME":
      return ` (${value})`;
    case "UNUSUAL_FREQUENCY":
      return " in one hour";
    case "UNUSUAL_TIME":
      return ` (${value.padStart(2, "0")}:00 UTC)`;
    default:
      return `: ${value}`;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Draft = Omit<TrustFactor, "points"> & { raw: number };

function buildDrafts(evidence: TrustEvidence, now: Date): Draft[] {
  const drafts: Draft[] = [];

  // --- Behavioral deviations (P2): one factor per deviation row.
  const behaviorWindow = TRUST_CATEGORIES.behavior.windowMs;
  for (const d of evidence.deviations) {
    const strength = decay(d.lastSeenAt, now, behaviorWindow);
    if (strength === 0) continue;
    const repeat = Math.min(DEVIATION_REPEAT.maxMultiplier, 1 + DEVIATION_REPEAT.perRepeat * (d.occurrences - 1));
    drafts.push({
      key: `behavior:${d.kind}:${d.dedupeKey}`,
      category: "behavior",
      code: d.kind,
      raw: DEVIATION_POINTS[d.kind] * CONFIDENCE_MULTIPLIER[d.confidence] * repeat * strength,
      summary: `${DEVIATION_LABEL[d.kind]}${deviationSubject(d.kind, d.dedupeKey)}${d.occurrences > 1 ? ` (seen ${d.occurrences}×)` : ""}`,
      at: d.lastSeenAt.toISOString(),
      evidence: [{ type: "behavioral_deviation", id: d.id }],
    });
  }

  // --- Blocked actions: grouped by (reason, action) so a retry loop is one line, not fifty.
  const blockWindow = TRUST_CATEGORIES.blocked.windowMs;
  const blockGroups = new Map<string, { raw: number; ids: string[]; latest: Date; action: string; defaultDeny: boolean }>();
  for (const b of evidence.blocks) {
    const strength = decay(b.createdAt, now, blockWindow);
    if (strength === 0) continue;
    const defaultDeny = b.decisionSource === "DEFAULT_DENY";
    const key = `blocked:${defaultDeny ? "default_deny" : "policy"}:${b.action}`;
    const group = blockGroups.get(key) ?? { raw: 0, ids: [], latest: b.createdAt, action: b.action, defaultDeny };
    group.raw += (defaultDeny ? BLOCK_POINTS.defaultDeny : BLOCK_POINTS.policyBlock) * strength;
    group.ids.push(b.id);
    if (b.createdAt > group.latest) group.latest = b.createdAt;
    blockGroups.set(key, group);
  }
  for (const [key, g] of blockGroups) {
    drafts.push({
      key,
      category: "blocked",
      code: g.defaultDeny ? "BLOCKED_NO_PERMISSION" : "BLOCKED_BY_POLICY",
      raw: g.raw,
      summary: g.defaultDeny
        ? `Attempted ${g.action} without a permission (${plural(g.ids.length, "attempt")})`
        : `${g.action} blocked by policy (${plural(g.ids.length, "time")})`,
      at: g.latest.toISOString(),
      evidence: g.ids.slice(0, 10).map((id) => ({ type: "policy_evaluation" as const, id })),
    });
  }

  // --- Policy violations (ALERT-decision policies matched).
  const violationWindow = TRUST_CATEGORIES.violations.windowMs;
  const violationGroups = new Map<string, { raw: number; ids: string[]; latest: Date; action: string }>();
  for (const v of evidence.violations) {
    const strength = decay(v.createdAt, now, violationWindow);
    if (strength === 0) continue;
    const group = violationGroups.get(v.action) ?? { raw: 0, ids: [], latest: v.createdAt, action: v.action };
    group.raw += VIOLATION_POINTS * strength;
    group.ids.push(v.id);
    if (v.createdAt > group.latest) group.latest = v.createdAt;
    violationGroups.set(v.action, group);
  }
  for (const [action, g] of violationGroups) {
    drafts.push({
      key: `violations:${action}`,
      category: "violations",
      code: "POLICY_VIOLATION",
      raw: g.raw,
      summary: `Policy violation on ${action} (${plural(g.ids.length, "time")})`,
      at: g.latest.toISOString(),
      evidence: g.ids.slice(0, 10).map((id) => ({ type: "policy_evaluation" as const, id })),
    });
  }

  // --- Security alerts (types listed in TRUST_ALERT_TYPES only; filtered by the evidence gatherer).
  const alertWindow = TRUST_CATEGORIES.alerts.windowMs;
  for (const a of evidence.alerts) {
    const strength = decay(a.lastSeenAt, now, alertWindow);
    if (strength === 0) continue;
    drafts.push({
      key: `alerts:${a.id}`,
      category: "alerts",
      code: a.type,
      raw: ALERT_SEVERITY_POINTS[a.severity] * ALERT_STATUS_MULTIPLIER[a.status] * strength,
      summary: `${a.severity.charAt(0)}${a.severity.slice(1).toLowerCase()} security alert: ${a.title}${a.status === "RESOLVED" ? " (resolved)" : a.status === "ACKNOWLEDGED" ? " (acknowledged)" : ""}`,
      at: a.lastSeenAt.toISOString(),
      evidence: [{ type: "security_alert", id: a.id }],
    });
  }

  // --- Approvals a human rejected, grouped by action.
  const approvalWindow = TRUST_CATEGORIES.approvals.windowMs;
  const approvalGroups = new Map<string, { raw: number; ids: string[]; latest: Date }>();
  for (const r of evidence.rejectedApprovals) {
    const strength = decay(r.resolvedAt, now, approvalWindow);
    if (strength === 0) continue;
    const group = approvalGroups.get(r.action) ?? { raw: 0, ids: [], latest: r.resolvedAt };
    group.raw += REJECTED_APPROVAL_POINTS * strength;
    group.ids.push(r.id);
    if (r.resolvedAt > group.latest) group.latest = r.resolvedAt;
    approvalGroups.set(r.action, group);
  }
  for (const [action, g] of approvalGroups) {
    drafts.push({
      key: `approvals:${action}`,
      category: "approvals",
      code: "APPROVAL_REJECTED",
      raw: g.raw,
      summary: `Approval for ${action} was rejected (${plural(g.ids.length, "time")})`,
      at: g.latest.toISOString(),
      evidence: g.ids.slice(0, 10).map((id) => ({ type: "approval_request" as const, id })),
    });
  }

  return drafts;
}

function buildLimits(evidence: TrustEvidence, now: Date): TrustLimit[] {
  const limits: TrustLimit[] = [];
  const { status } = evidence.agent;
  if (status === "PAUSED" || status === "STOPPED" || status === "ARCHIVED") {
    limits.push({
      code: "OPERATOR_CONTROL",
      ceiling: null,
      summary:
        status === "STOPPED"
          ? "An operator stopped this agent (kill switch), so it is restricted regardless of its evidence."
          : status === "PAUSED"
            ? "An operator paused this agent, so it is restricted until it is resumed."
            : "This agent is archived, so it is restricted.",
    });
  }

  const ageDays = Math.floor((now.getTime() - evidence.agent.createdAt.getTime()) / DAY_MS);
  const young = ageDays < TRUST_HISTORY_REQUIREMENT.minAgeDays;
  const immature = evidence.baselineMaturity !== "ESTABLISHED";
  if (young || immature) {
    const missing: string[] = [];
    if (young) missing.push(`the agent is ${plural(Math.max(ageDays, 0), "day")} old (needs ${TRUST_HISTORY_REQUIREMENT.minAgeDays}+)`);
    if (immature) {
      missing.push(
        `its behavioral baseline is ${(evidence.baselineMaturity ?? "NEW_AGENT").toLowerCase().replace(/_/g, " ")} (needs established)`
      );
    }
    limits.push({
      code: "INSUFFICIENT_HISTORY",
      ceiling: TRUST_HISTORY_REQUIREMENT.ceilingScore,
      summary: `Not enough history to be Trusted: ${missing.join(" and ")}. Absence of bad evidence is not proof of good behavior.`,
    });
  }
  return limits;
}

/**
 * Computes the agent's trust from evidence. `previous` is the state before
 * this evaluation (null for the first one) and only affects hysteresis.
 */
export function computeTrust(evidence: TrustEvidence, now: Date, previous: TrustState | null): TrustResult {
  const drafts = buildDrafts(evidence, now);

  const categories: TrustCategoryTotal[] = [];
  const factors: TrustFactor[] = [];
  for (const name of Object.keys(TRUST_CATEGORIES) as TrustCategoryName[]) {
    const config = TRUST_CATEGORIES[name];
    const inCategory = drafts.filter((d) => d.category === name);
    const raw = inCategory.reduce((sum, d) => sum + d.raw, 0);
    const applied = Math.min(raw, config.cap);
    const scale = raw > 0 ? applied / raw : 0;
    categories.push({
      category: name,
      label: config.label,
      count: inCategory.length,
      raw: round1(raw),
      applied: round1(applied),
      cap: config.cap,
      capped: raw > config.cap,
    });
    for (const draft of inCategory) {
      const { raw: draftRaw, ...factor } = draft;
      const points = round1(draftRaw * scale);
      if (points > 0) factors.push({ ...factor, points });
    }
  }
  factors.sort((a, b) => b.points - a.points || a.key.localeCompare(b.key));

  const totalPenalty = categories.reduce((sum, c) => sum + c.applied, 0);
  const evidenceScore = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  const limits = buildLimits(evidence, now);
  const ceiling = limits.reduce((min, l) => (l.ceiling === null ? min : Math.min(min, l.ceiling)), 100);
  const score = Math.min(evidenceScore, ceiling);

  const restricted = limits.some((l) => l.code === "OPERATOR_CONTROL");
  const state = restricted ? "RESTRICTED" : stateForScore(score, previous);

  return {
    evidenceScore,
    score,
    state,
    factors: factors.slice(0, TRUST_MAX_FACTORS),
    limits,
    categories,
    omittedFactors: Math.max(0, factors.length - TRUST_MAX_FACTORS),
  };
}

/** Initialization, any state change, or a score move of at least TRUST_MIN_SCORE_DELTA is worth a history row. */
export function isMeaningfulChange(
  last: { state: TrustState; score: number } | null,
  next: { state: TrustState; score: number }
): boolean {
  if (!last) return true;
  return last.state !== next.state || Math.abs(last.score - next.score) >= TRUST_MIN_SCORE_DELTA;
}

/** What changed between two snapshots, factor by factor (and limit by limit). */
export function diffSnapshots(before: TrustSnapshot | null, after: TrustSnapshot): TrustChange[] {
  const changes: TrustChange[] = [];
  const beforeFactors = new Map((before?.factors ?? []).map((f) => [f.key, f]));
  const afterFactors = new Map(after.factors.map((f) => [f.key, f]));

  for (const [key, f] of afterFactors) {
    const prior = beforeFactors.get(key);
    if (!prior) {
      changes.push({ key, category: f.category, kind: "added", before: 0, after: f.points, summary: f.summary });
    } else if (f.points - prior.points >= 1) {
      changes.push({ key, category: f.category, kind: "increased", before: prior.points, after: f.points, summary: f.summary });
    } else if (prior.points - f.points >= 1) {
      changes.push({ key, category: f.category, kind: "decreased", before: prior.points, after: f.points, summary: f.summary });
    }
  }
  for (const [key, f] of beforeFactors) {
    if (!afterFactors.has(key)) {
      changes.push({ key, category: f.category, kind: "removed", before: f.points, after: 0, summary: f.summary });
    }
  }

  const beforeLimits = new Map((before?.limits ?? []).map((l) => [l.code, l]));
  const afterLimits = new Map(after.limits.map((l) => [l.code, l]));
  for (const [code, l] of afterLimits) {
    if (!beforeLimits.has(code)) changes.push({ key: `limit:${code}`, category: "limit", kind: "added", before: 0, after: 1, summary: l.summary });
  }
  for (const [code, l] of beforeLimits) {
    if (!afterLimits.has(code)) changes.push({ key: `limit:${code}`, category: "limit", kind: "removed", before: 1, after: 0, summary: l.summary });
  }
  return changes;
}

function joinTop(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return shown.join("; ") + (rest > 0 ? `; and ${rest} more` : "");
}

const LIMIT_SHORT: Record<TrustLimit["code"], { on: string; off: string }> = {
  OPERATOR_CONTROL: { on: "an operator restricted the agent", off: "the operator restriction was lifted" },
  INSUFFICIENT_HISTORY: { on: "history is not yet sufficient for Trusted", off: "history is now sufficient for Trusted" },
};

/** The human-readable "why" of one transition, plus the structured changes behind it. */
export function describeTransition(previous: TrustSnapshot | null, next: TrustSnapshot): TrustTransitionDescription {
  const changes = diffSnapshots(previous, next);

  const worsened = changes
    .filter((c) => c.kind === "added" || c.kind === "increased")
    .sort((a, b) => b.after - b.before - (a.after - a.before));
  const improved = changes
    .filter((c) => c.kind === "removed" || c.kind === "decreased")
    .sort((a, b) => b.before - b.after - (a.before - a.after));
  const factorLine = (list: TrustChange[]) =>
    joinTop(list.filter((c) => c.category !== "limit").map((c) => c.summary));
  const limitLine = (kind: "added" | "removed") =>
    changes
      .filter((c) => c.category === "limit" && c.kind === kind)
      .map((c) => LIMIT_SHORT[c.key.slice("limit:".length) as TrustLimit["code"]][kind === "added" ? "on" : "off"]);

  if (!previous) {
    const drivers = next.factors.length > 0 ? `Evidence lowering it: ${factorLine(next.factors.map((f) => ({ ...f, kind: "added" as const, before: 0, after: f.points })))}.` : "No negative evidence.";
    const limited = next.limits.map((l) => l.summary).join(" ");
    return {
      direction: "initialized",
      summary: `Trust initialized as ${STATE_LABEL[next.state]} (score ${next.score}). ${drivers}${limited ? ` ${limited}` : ""}`,
      changes,
    };
  }

  const stateChanged = previous.state !== next.state;
  const direction: TrustTransitionDescription["direction"] =
    next.score < previous.score || (stateChanged && rank(next.state) > rank(previous.state))
      ? "degraded"
      : next.score > previous.score || (stateChanged && rank(next.state) < rank(previous.state))
        ? "recovered"
        : "shifted";

  const head = stateChanged
    ? `Trust ${direction === "recovered" ? "recovered" : "degraded"} from ${STATE_LABEL[previous.state]} to ${STATE_LABEL[next.state]} (${previous.score} → ${next.score})`
    : `Trust score ${direction === "recovered" ? "rose" : "fell"} from ${previous.score} to ${next.score} (still ${STATE_LABEL[next.state]})`;

  const reasons: string[] = [];
  if (direction === "degraded") {
    const f = factorLine(worsened);
    if (f) reasons.push(f);
    reasons.push(...limitLine("added"));
  } else {
    const f = factorLine(improved);
    if (f) reasons.push(`these no longer weigh as much: ${f}`);
    reasons.push(...limitLine("removed"));
  }
  return {
    direction,
    summary: `${head}${reasons.length > 0 ? ` because ${reasons.join("; ")}` : ""}.`,
    changes,
  };
}

/** One-sentence answer to "why is the agent in this state?". */
export function headline(snapshot: TrustSnapshot): string {
  const limit = snapshot.limits.find((l) => l.code === "OPERATOR_CONTROL");
  if (limit) return limit.summary;
  const factors = snapshot.factors;
  const history = snapshot.limits.find((l) => l.code === "INSUFFICIENT_HISTORY");
  if (factors.length === 0) {
    return history ? `No negative evidence recently. ${history.summary}` : "No negative evidence recently, with enough history to rely on.";
  }
  const lead = joinTop(
    factors.map((f) => `${f.summary} (−${f.points})`),
    3
  );
  return `${STATE_LABEL[snapshot.state]} because of: ${lead}.${history ? ` ${history.summary}` : ""}`;
}
