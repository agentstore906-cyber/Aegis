# Retention

## What is enforced today: plan-based activity retention

Each plan has an activity-history window (`PLANS[plan].activityRetentionDays`, `lib/billing/plans.ts`):

| Plan | Activity history |
|---|---|
| Free | 7 days |
| Startup | 30 days |
| Growth | 90 days |
| Business / Enterprise | 365 days |

A purge job (**not scheduled** — see below) deletes **`ActivityEvent` rows older than the organization's plan window** when run in delete mode:

- Code: `lib/retention/activity.ts` (`purgeExpiredActivity`); route `GET /api/internal/retention/purge`
  (`app/api/internal/retention/purge/route.ts`).
- **Not scheduled.** `vercel.json` deliberately has NO retention cron entry, so a deploy deletes nothing. Going live is
  a deliberate, reviewed step: after a dry run has been reviewed, set `AEGIS_RETENTION_PURGE_ENABLED=true` and add
  `{ "path": "/api/internal/retention/purge?mode=delete", "schedule": "45 1 * * *" }` (after the 00:15 behavior
  refresh). A cron entry without `?mode=delete` only ever dry-runs.
- Auth: `Authorization: Bearer $CRON_SECRET` (shared gate `lib/server/cron-auth.ts`), checked before anything else;
  fails closed (503) when `CRON_SECRET` is unset, 401 on a wrong bearer. Returns counts only.
- **Safe by default.** A request with no parameters is a **dry run**: it counts what would be deleted
  (`events`) and what is being preserved (`eventsPreservedForEvidence`) and deletes nothing. Deleting needs BOTH
  `?mode=delete` AND `AEGIS_RETENTION_PURGE_ENABLED=true` in the deployment (`lib/retention/mode.ts`); `?mode=delete`
  without the env switch is refused (409), an unrecognized `mode` is refused (400), and `dryRun=0`, `dryRun=false` or
  any typo can never delete. **Run a dry run before the first delete run:** that run deletes every existing event
  older than the window (for Free, everything older than 7 days), subject to the preservation rules below.
- **Evidence is preserved** (`lib/retention/evidence.ts`): activity events that belong to the run of an incident or a
  security alert (or of one of its occurrences), an incident's anchor event, and the event an incident's anchor policy
  evaluation points at are never deleted, even past the window — the product retains alerts and incidents, and an
  incident's timeline is rebuilt from those events. The check is repeated inside the DELETE statement itself, so an
  incident opened between choosing and deleting rows still protects them.
- The cutoff is `now − days × 24h` on UTC instants — no timezone or DST dependence. Only rows with
  `timestamp < cutoff` are touched; nothing newer is ever selected.
- Per organization, per agent, always filtered by `organizationId` and `agentId`.
- Organizations whose `plan` string is not a known plan id are **skipped** (not treated as Free).
- **Billing anomaly guard (always wins):** an organization on the Free plan whose `subscriptionStatus` is `active`,
  `trialing` or `past_due` is skipped — billing state is wrong, not the customer's choice. Reported as
  `organizationsSkippedBillingAnomaly`. No other rule, including the grace period, can override it.
- **Downgrade grace period:** after Aegis applies a paid → Free downgrade it stamps `Organization.planDowngradedAt`
  (processing time, once, on the transition — repeated/retried/out-of-order events never move it, re-subscribing clears
  it). For 14 days (`DOWNGRADE_GRACE_DAYS`) from that stamp the organization is skipped
  (`organizationsSkippedDowngradeGrace`); afterwards the normal Free window applies. Organizations that have always
  been Free, and cancelled/expired organizations with no stamp (for example ended before the column existed), have no grace
  period to apply and follow normal Free retention (7 days). A *paused* organization with no stamp is different — see the
  hold below. The grace period does not relax tenant scoping or any other rule.
- **Paused-subscription hold (90 days):** a *paused* subscription may resume, so while `subscriptionStatus` is `paused`
  the organization's history is held for up to 90 days (`PAUSED_HOLD_DAYS`) from `planDowngradedAt`, the moment the pause
  dropped it to Free. Skipped organizations are counted in `organizationsSkippedPausedHold`. If `planDowngradedAt` is NULL
  the pause start is unknown, so nothing is deleted and the organization is counted separately in
  `organizationsSkippedPausedNoAnchor`. Once the 90 days have passed, normal Free rules apply (the 7-day window).
  - **Resume** restores the plan and clears `planDowngradedAt`, so the plan's own window applies again from then on.
  - **Ending a downgraded subscription** (paused, or paused then `past_due` after a failed payment, → cancelled/expired)
    restamps `planDowngradedAt` (`lib/billing/subscription-decision.ts`), so an old pause time — or no pause time, for a
    legacy paused row — cannot skip the 14-day cancellation grace period. A repeated cancel event does not restamp it, and
    an organization that never had a subscription (no subscription id) is never given a stamp. Limitation: a Free
    `past_due` organization that has a subscription is stamped when it ends even if it was never paused (14 extra days of
    retention, never less).
  - **Legacy paused rows with no stamp** (paused before the column existed) stay held as `paused_no_anchor` until they
    resume or end; an operator-run backfill can bound that hold at 90 days (not run by default).
  - **Storage:** a paused organization keeps everything it ingests for up to 90 days instead of 7; this is the only cost.
  - No schema change: it uses the existing `subscriptionStatus` and `planDowngradedAt` columns. Like all retention rules,
    this only matters once the purge is scheduled and delete mode is enabled (neither is true today).
- Events the behavioral baseline has not folded into its hourly rollups yet (`AgentBehaviorState.rollupThrough`) are
  kept until a later run, so a delayed baseline refresh never costs an agent its learned behavior. Archived agents are
  not baselined and are not held back.
- Batched (500/delete) and time-budgeted (40 s); a run that stops early resumes on the next day's run.
- Deleting an event is permitted by the append-only triggers (`UPDATE`-only); policy evaluations, deviations and child
  events that pointed at it have that link set to null (`ON DELETE SET NULL`), and keep their own data.
- Downgrades are real: when billing drops an organization to Free, activity older than 7 days is deleted by the next run.

**Consequences worth knowing:** with raw events limited to the plan window, "has this agent done this before?" checks
that read raw events see only that window on Free; baselines read hourly rollups (28-day window), which are not purged
by this job.

## What is still configuration only

`Organization.activityRetentionDays`, `.auditRetentionDays`, `.securityRetentionDays` (nullable; `null` = no
configured limit) are editable in `/settings/organization` but **delete nothing**. The plan window above is the
maximum and cannot be extended by `activityRetentionDays`. **Audit events, security alerts, policy evaluations and
incidents are not deleted by any job.**

If audit/security deletion is built later it should be its own, clearly-named function (audit events are
append-only evidence), leave a record that the deletion happened, and be batched and scoped like the job above.

## Operating it

- Needs `CRON_SECRET` in the environment (already required by the behavior refresh cron).
- Logs one JSON line per run: `{"msg":"activity_retention_purge", ...counts}`.
- Tests: `lib/retention/__tests__` (cutoff maths, boundary rules; integration: plan windows, strict cutoff, unknown
  plan, rollup hold-back, dry run, batching, tenant scoping, trigger compatibility), `lib/server/__tests__/cron-auth.test.ts`.

## Retention and "first time" detectors

The new-sensitive-action, new-tool and new-namespace detectors ask "has this agent done this before?". Raw
`activity_events` are purged by plan, so that question is answered from three records (`lib/security/history.ts`):
retained events, hourly behavior rollups (`agent_activity_rollups`, 90 days, survive event purges), and an earlier alert
of the same type and dedupe key (alerts are never purged). A genuinely first-time action has none of them and still
alerts. Residual limit: an action whose only trace was a purged event, with no rollup (it was BLOCKED / approval-pending
only) and no alert, and older than the rollup window, can still alert once as new.

## Failure isolation

`purgeExpiredActivity` processes organizations independently. An organization that throws is recorded in `failures`
(`organizationId`, `errorName`, `errorCode` only — never messages, SQL or event data) and counted in
`organizationsFailed`; later organizations still run, deletions already made stay counted, and `complete` is `false`.
The cron route answers HTTP 500 when any organization failed, with the full truthful body. Failed organizations are
simply retried by the next day's run.
