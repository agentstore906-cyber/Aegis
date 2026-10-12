import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getPlan, isPlanId } from "@/lib/billing/plans";
import { sqlTimestamp } from "@/lib/behavior/rollup";
import { EVIDENCE_PROTECTED } from "@/lib/retention/evidence";

/**
 * Plan-based activity retention: deletes `ActivityEvent` rows older than the organization's PLAN window
 * (`PLANS[plan].activityRetentionDays`: Free 7, Startup 30, Growth 90, Business/Enterprise 365).
 *
 * Safety rules, each covered by lib/retention/__tests__:
 *  - Instants only. The cutoff is `now - days * 24h` on UTC timestamps, so it never depends on a timezone or DST.
 *  - Strictly older only (`timestamp < cutoff`). Nothing newer than the cutoff is ever selected.
 *  - Per organization, per agent: every query carries `organizationId` and `agentId`; one tenant's window never
 *    reaches another's rows.
 *  - Unknown plan strings are SKIPPED. `getPlan` falls back to Free for entitlement checks, which is right for
 *    granting nothing extra but would be a data-loss bug here.
 *  - Rows the behavioral baseline has not yet folded into its hourly rollups are kept (see `purgeBoundary`), so a
 *    late cron never costs an agent its learned behavior. Archived agents are not baselined and are not held back.
 *  - Batched, time-budgeted and resumable: a run that stops early simply continues on the next day's run.
 *  - `dryRun` counts and deletes nothing.
 *
 * Only activity events are purged. Audit events, security alerts, policy evaluations and incidents are untouched:
 * they are evidence and have their own (still unenforced) settings — see docs/retention.md. Activity events that are
 * the evidence behind a kept alert or incident are preserved too (lib/retention/evidence.ts). The organization's own
 * `activityRetentionDays` column is configuration only; the plan window is the maximum and is the only thing enforced.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 500;

export function activityRetentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * The exclusive upper bound of what may be deleted for one agent, or null when nothing may be deleted yet.
 * A live agent's events are only deletable once they are inside the rolled-up history (`rollupThrough`).
 */
export function purgeBoundary(cutoff: Date, agent: { status: string; rollupThrough: Date | null }): Date | null {
  if (agent.status === "ARCHIVED") return cutoff;
  if (!agent.rollupThrough) return null;
  return agent.rollupThrough < cutoff ? agent.rollupThrough : cutoff;
}

/** After a confirmed paid -> Free downgrade, Free-plan deletion waits this long (measured from `Organization.planDowngradedAt`). */
export const DOWNGRADE_GRACE_DAYS = 14;

/**
 * A PAUSED subscription may resume, so its history is held (not purged) for up to this long, measured from
 * `Organization.planDowngradedAt` (stamped when the pause dropped the workspace to Free). After the cap, normal Free rules
 * apply. Resuming clears `planDowngradedAt`; pausing -> cancelled/expired restamps it (lib/billing/subscription-decision.ts).
 */
export const PAUSED_HOLD_DAYS = 90;

/** Subscription states that mean "this organization is paying (or in dunning)" — Free is never a valid plan for them. */
const PAYING_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

export type RetentionOrg = {
  plan: string;
  subscriptionStatus: string | null;
  planDowngradedAt: Date | null;
};

export type RetentionEligibility =
  | { eligible: true }
  | { eligible: false; reason: "unknown_plan" | "billing_anomaly" | "paused_hold" | "paused_no_anchor" | "downgrade_grace" };

/**
 * Whether an organization's history may be purged at all right now. Checked in this order, and the order matters:
 *  1. unknown plan string            -> never purge (we do not know what it should keep);
 *  2. billing anomaly                -> never purge: the organization is on Free while its subscription is
 *                                       active / trialing / past_due, which means billing state is wrong, not that
 *                                       the customer chose Free. No grace period and no other rule can override this;
 *  3. paused subscription            -> hold for up to PAUSED_HOLD_DAYS from `planDowngradedAt`; if that timestamp is
 *                                       missing the pause start is unknown, so nothing is deleted (`paused_no_anchor`);
 *  4. recent confirmed downgrade     -> wait out DOWNGRADE_GRACE_DAYS from `planDowngradedAt`.
 * Everything else (including an organization that has always been Free) follows its plan's normal window.
 * Nothing here relaxes tenant scoping, which the purge applies to every query regardless.
 */
export function retentionEligibility(org: RetentionOrg, now: Date): RetentionEligibility {
  if (!isPlanId(org.plan)) return { eligible: false, reason: "unknown_plan" };
  if (org.plan === "free" && org.subscriptionStatus && PAYING_STATUSES.has(org.subscriptionStatus)) {
    return { eligible: false, reason: "billing_anomaly" };
  }
  if (org.plan === "free" && org.subscriptionStatus === "paused") {
    if (!org.planDowngradedAt) return { eligible: false, reason: "paused_no_anchor" };
    if (now.getTime() < org.planDowngradedAt.getTime() + PAUSED_HOLD_DAYS * DAY_MS) return { eligible: false, reason: "paused_hold" };
  }
  if (org.plan === "free" && org.planDowngradedAt && now.getTime() < org.planDowngradedAt.getTime() + DOWNGRADE_GRACE_DAYS * DAY_MS) {
    return { eligible: false, reason: "downgrade_grace" };
  }
  return { eligible: true };
}

export type PurgeOptions = {
  now?: Date;
  /** Wall-clock budget for the whole run. */
  budgetMs?: number;
  batchSize?: number;
  dryRun?: boolean;
  /** Restrict to these organizations (tests, manual runs). */
  organizationIds?: string[];
};

export type PurgeResult = {
  dryRun: boolean;
  organizationsScanned: number;
  organizationsSkippedUnknownPlan: number;
  /** Free plan but an active / trialing / past_due subscription: billing is inconsistent, so nothing is deleted. */
  organizationsSkippedBillingAnomaly: number;
  /** Recently downgraded to Free: inside the 14-day grace period. */
  organizationsSkippedDowngradeGrace: number;
  /** Paused subscription inside the 90-day hold: history kept in case it resumes. */
  organizationsSkippedPausedHold: number;
  /** Paused subscription with no recorded pause start: nothing is deleted until it is known. */
  organizationsSkippedPausedNoAnchor: number;
  agentsHeldForRollup: number;
  /** Deleted (or, in a dry run, deletable) activity events. */
  events: number;
  /** Past-cutoff events kept because they are the evidence behind a retained security alert or incident. */
  eventsPreservedForEvidence: number;
  /** Organizations whose processing threw. Their failure never stops the organizations after them. */
  organizationsFailed: number;
  /** One entry per failed organization: id + error class/code only — never messages, SQL, parameters or event data. */
  failures: RetentionFailure[];
  /** False when the run stopped early (time budget) OR any organization failed. */
  complete: boolean;
  durationMs: number;
};

export type RetentionFailure = { organizationId: string; errorName: string; errorCode: string | null };

/** A safe description of a failure: the class and (for Prisma) the error code, never the message (which can echo SQL/values). */
export function describeRetentionFailure(organizationId: string, error: unknown): RetentionFailure {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : null;
  return { organizationId, errorName, errorCode: typeof code === "string" ? code.slice(0, 32) : null };
}

export async function purgeExpiredActivity(options: PurgeOptions = {}): Promise<PurgeResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const budgetMs = options.budgetMs ?? 40_000;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = options.dryRun ?? false;
  const outOfTime = () => Date.now() - startedAt >= budgetMs;

  const result: PurgeResult = {
    dryRun,
    organizationsScanned: 0,
    organizationsSkippedUnknownPlan: 0,
    organizationsSkippedBillingAnomaly: 0,
    organizationsSkippedDowngradeGrace: 0,
    organizationsSkippedPausedHold: 0,
    organizationsSkippedPausedNoAnchor: 0,
    agentsHeldForRollup: 0,
    events: 0,
    eventsPreservedForEvidence: 0,
    organizationsFailed: 0,
    failures: [],
    complete: true,
    durationMs: 0,
  };

  const organizations = await prisma.organization.findMany({
    where: options.organizationIds ? { id: { in: options.organizationIds } } : {},
    select: { id: true, plan: true, subscriptionStatus: true, planDowngradedAt: true },
    orderBy: { id: "asc" },
  });

  for (const organization of organizations) {
    if (outOfTime()) {
      result.complete = false;
      break;
    }
    const eligibility = retentionEligibility(organization, now);
    if (!eligibility.eligible) {
      if (eligibility.reason === "unknown_plan") result.organizationsSkippedUnknownPlan += 1;
      else if (eligibility.reason === "billing_anomaly") result.organizationsSkippedBillingAnomaly += 1;
      else if (eligibility.reason === "paused_hold") result.organizationsSkippedPausedHold += 1;
      else if (eligibility.reason === "paused_no_anchor") result.organizationsSkippedPausedNoAnchor += 1;
      else result.organizationsSkippedDowngradeGrace += 1;
      continue;
    }
    // One organization failing (a bad row, a lock timeout, a transient DB error) must not abort the rest. Whatever it
    // had already deleted stays counted; every delete is individually tenant-scoped, so nothing leaks across it.
    try {
      result.organizationsScanned += 1;
      const cutoff = activityRetentionCutoff(getPlan(organization.plan).activityRetentionDays, now);

      const [agents, states] = await Promise.all([
        prisma.agent.findMany({ where: { organizationId: organization.id }, select: { id: true, status: true } }),
        prisma.agentBehaviorState.findMany({ where: { organizationId: organization.id }, select: { agentId: true, rollupThrough: true } }),
      ]);
      const rolledThrough = new Map(states.map((s) => [s.agentId, s.rollupThrough]));

      for (const agent of agents) {
        const boundary = purgeBoundary(cutoff, { status: agent.status, rollupThrough: rolledThrough.get(agent.id) ?? null });
        if (!boundary) {
          result.agentsHeldForRollup += 1;
          continue;
        }
        const scope = Prisma.sql`e."organizationId" = ${organization.id} AND e."agentId" = ${agent.id} AND e."timestamp" < ${sqlTimestamp(boundary)}`;

        // Evidence for kept alerts/incidents is never deletable; count it so a dry run shows what is being preserved.
        const [{ preserved }] = await prisma.$queryRaw<{ preserved: number }[]>`
          SELECT COUNT(*)::int AS preserved FROM "activity_events" e WHERE ${scope} AND ${EVIDENCE_PROTECTED}`;
        result.eventsPreservedForEvidence += Number(preserved);

        if (dryRun) {
          const [{ deletable }] = await prisma.$queryRaw<{ deletable: number }[]>`
            SELECT COUNT(*)::int AS deletable FROM "activity_events" e WHERE ${scope} AND NOT ${EVIDENCE_PROTECTED}`;
          result.events += Number(deletable);
          continue;
        }
        for (;;) {
          if (outOfTime()) {
            result.complete = false;
            break;
          }
          const batch = await prisma.$queryRaw<{ id: string }[]>`
            SELECT e."id" FROM "activity_events" e
             WHERE ${scope} AND NOT ${EVIDENCE_PROTECTED}
             ORDER BY e."timestamp" ASC LIMIT ${batchSize}`;
          if (batch.length === 0) break;
          // Tenant, agent, cutoff AND the evidence exemption are all re-asserted inside the DELETE itself, so a row is
          // only removed if it is still deletable at that instant (an incident opened since the SELECT protects it).
          const deleted = await prisma.$executeRaw`
            DELETE FROM "activity_events" e
             WHERE e."id" = ANY(${batch.map((row) => row.id)}::text[]) AND ${scope} AND NOT ${EVIDENCE_PROTECTED}`;
          result.events += deleted;
          // Nothing removed despite candidates means they just became protected; stop rather than spin.
          if (deleted === 0 || batch.length < batchSize) break;
        }
        if (!result.complete) break;
      }
      if (!result.complete) break;
    } catch (error) {
      const failure = describeRetentionFailure(organization.id, error);
      result.organizationsFailed += 1;
      result.failures.push(failure);
      console.error(JSON.stringify({ msg: "activity_retention_org_failed", ...failure }));
    }
  }

  if (result.organizationsFailed > 0) result.complete = false;
  result.durationMs = Date.now() - startedAt;
  return result;
}
