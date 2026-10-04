# Aegis P2 — Behavioral Memory

**Status:** implemented and verified locally on 2026-10-03. **Not deployed.**
P2 builds on P0 and P1, which are also uncommitted and undeployed.

**Goal:** give every agent a persistent, explainable answer to *"what does
normal look like for THIS agent?"* and *"what has changed?"*.

**Scope:**
- Every baseline is per agent; there is no global or fleet baseline.
- All statistics are deterministic. There is no ML and no model-generated
  score.
- Deviations are **behavioral evidence only**: in P2 they don't change any
  decision, raise no alert, and are not used for trust. Trust and the unified
  risk engine come later (`docs/AEGIS_V2_ROADMAP.md`).

**What it replaces.** The former `lib/security/baseline.ts`, a seven-day
average recomputed on every page view, is removed, along with its card and
test. The agent overview now shows a behavior summary, and a new **Behavior**
tab gives the full view.

**Migration:** `prisma/migrations/20261003120000_p2_behavioral_memory/`.

## Verification

All runs used the local disposable database `localhost/aegis_test`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` | 0 errors, 1 pre-existing warning |
| `npm test` (no test DB, unit tests only) | **46 files, 438 tests, all passed** |
| Full suite (`DATABASE_URL_TEST=…/aegis_test`) | **71 files, 717 tests, all passed** |
| `npx next build` | compiled; 4 API routes + 1 internal route added |
| Mutation check: outlier-hour exclusion removed | caught (6 tests failed) |
| Mutation check: "2+ days to become normal" rule weakened | caught |

**Test changes:**
- **New: 47 tests.**
  - `lib/behavior/__tests__/stats-profile.test.ts` (10)
  - `lib/behavior/__tests__/detect.test.ts` (12)
  - `components/behavior/__tests__/behavior-view.test.tsx` (3)
  - `lib/__tests__/p2-behavioral-memory.integration.test.ts` (22)
- **Removed:** the 5 tests of the replaced seven-day function.

---

## 1. Architecture

```
activity_events  ──(closed hours, exact recomputation)──►  agent_activity_rollups   (hourly, per agent × dimension × value)
                                                                │
                              once per UTC day, per agent ──────┤  aggregate the 28-day learning window
                                                                ▼
                                                     agent_baselines  (versioned, immutable profile JSON)
                                                                │
 POST /events · /evaluate ── after the response ──► observe event vs. latest baseline ──► behavioral_deviations
```

| Piece | File |
|---|---|
| Parameters, every threshold | `lib/behavior/config.ts` |
| Statistics (pure) | `lib/behavior/stats.ts` |
| Profile + cold start (pure) | `lib/behavior/profile.ts` |
| Deviation rules + explanations (pure) | `lib/behavior/detect.ts` |
| Hourly rollups (SQL) | `lib/behavior/rollup.ts` |
| Versioned baselines | `lib/behavior/baseline.ts` |
| Per-event observation | `lib/behavior/observe.ts` |
| Read API (tenant-scoped) | `lib/behavior/queries.ts` |
| Scheduled pre-computation | `lib/behavior/refresh.ts`, `app/api/internal/behavior/refresh`, `vercel.json` |
| UI | `components/behavior/behavior-view.tsx`, agent page "Behavior" tab |

**Processing model.**
- **Lazy first.** Nothing needs a scheduler to be correct. The first event
  observed, or the first profile viewed, for an agent on a new UTC day rolls
  up its closed hours and appends that day's baseline version.
- **Serialized per agent.** The work runs in one transaction under a
  per-agent advisory lock, so concurrent requests compute it once (tested
  with 4 concurrent callers producing 1 version).
- **Optional cron.** A daily cron (`vercel.json`, 00:15 UTC) only
  pre-computes, so the first request of the day doesn't pay for it. It is
  protected by `CRON_SECRET`; without the secret the endpoint returns `503`,
  so it fails closed.

## 2. Profile dimensions: only reliable data

| Dimension | Source field | Notes |
|---|---|---|
| action | `action` | always present |
| eventType ("action types") | `eventType` | always present |
| tool | `toolKey` (P1-normalized) | when reported |
| service | `service` | when reported |
| destination | `destination` (host / domain only) | when reported |
| dataClass ("data types") | `dataClasses` | when reported; one count per class |
| environment | `environment` (server-side) | P1+ rows |
| endUser | `endUserHash` (pseudonym) | when reported |
| outcome | `outcome` | P1+ `/events` rows |
| decision ("historical policy decisions") | `status` of `/evaluate` rows | all decisions, including BLOCKED |
| transition ("action sequences") | parent action → child action | only for events with a P1 parent link |
| frequency, time pattern | hourly totals | derived |
| volume | per-event `recordCount` / `byteCount` | when reported |

**Units.** Counts are in *recorded events*. An `/evaluate` decision and the
execution reported for it (`evaluationId`) are two events. The baseline and
the current hour use the same unit, so comparisons stay consistent.

**Not profiled:** free-text fields, `resource` (too high-cardinality and
often personal), cost (already covered by cost intelligence), and anything
the agent doesn't report.

## 3. Rollups

`agent_activity_rollups` holds `(agent, UTC hour, dimension, key) → count`;
`total` rows also carry `recordSum` and `byteSum`.

**Exact, not incremental.** Events are bucketed by Aegis's receipt
`timestamp` (P1). A *closed* hour can never gain events, so each rollup range
is deleted and recomputed from `activity_events` in one
`INSERT … SELECT`. The result is idempotent (tested: recomputing gives
identical sums) and self-healing; there is no counter drift.

**Learnable events only.** `BLOCKED` and `APPROVAL_REQUIRED` rows never teach
"normal", because they didn't execute as-is. The exception is the `decision`
dimension, which records every policy decision.

**Retention and bounds.**
- Rollups are kept for 90 days and pruned on refresh.
- Catch-up is bounded per call.

**Time zones.** `timestamp` is `timestamp without time zone` holding UTC.
Raw SQL therefore passes instants as ISO strings cast to `::timestamp` and
returns ISO text, so results never depend on the database session or host
time zone.

## 4. Baseline methodology

**Learning window.** The 28 full UTC days ending at the **start of today**.
Today's activity is never part of the baseline it's compared against. A new,
immutable version is appended at most once per UTC day; all versions are
kept as history.

**Categorical dimensions.** Each value is stored with count, share, days
seen, first seen, and last seen.
- **Established** ("normal"): seen **3+ times on 2+ distinct days**.
- **Provisional:** seen, but not enough to count as normal.
- **High-cardinality:** a dimension with more than 500 distinct values. It is
  profiled, but makes no "new value" claims, because Aegis can't truthfully
  say what's new.

**Statistics.** All are plain descriptive statistics: n, mean, sample
standard deviation, min, median, p90, p95, p99, max. Percentiles use linear
interpolation between closest ranks (type 7, the same as Postgres
`percentile_cont`).

| Statistic | Computed over |
|---|---|
| Frequency | events per **active** hour and per active day; plus the share of hours active since first activity |
| Time pattern | events per UTC hour of day (24 buckets) |
| Volume | per-event `recordCount` / `byteCount` (most recent 20,000 in the window), summarized robustly (§6) |

## 5. Cold start

| State | Rule (learning window, learnable events) | What is evaluated |
|---|---|---|
| **NEW_AGENT** | fewer than 3 active days **or** fewer than 50 events | nothing; the UI says "learning" and shows how much has been seen |
| **LIMITED_HISTORY** | otherwise, fewer than 7 active days or fewer than 200 events | only first-time values (tool, destination, service, data type, action type, sequence, end user), all at **LOW** confidence |
| **ESTABLISHED** | 7+ active days **and** 200+ events | everything, at MEDIUM confidence, or HIGH with 200+ observations and 14+ active days |

**Additional per-rule guards.** A rule makes no claim without the evidence
behind it:
- A dimension needs **20+ observations** before "new value" means anything.
- Hourly statistics need **24+ active hours**.
- Volume needs **20+ observations**.
- "Never at this hour" needs **14+ active days**.
- New end users are only remarkable for agents with **10 or fewer**
  established users.

## 6. Learning and outlier handling

One abnormal incident must not immediately redefine normal:

1. **Today never teaches itself.** A burst today is compared with a baseline
   that ends at midnight.
2. **Repetition requirement.** A new value becomes normal only after 3+ uses
   on 2+ distinct days. A one-day burst stays provisional and keeps being
   flagged. The explanation then says it "appeared only N time(s) on 1
   day(s)".
3. **Flagged hours are excluded.** Hours already recorded as
   `UNUSUAL_FREQUENCY` are excluded from the frequency and time-of-day
   statistics of later baselines (tested: a 40-event burst hour doesn't move
   p95 or max).
4. **Robust volume.** Values above 10 × p95 are excluded from mean, stddev,
   and max, and counted as `excludedOutliers`. Percentiles are robust anyway
   (tested: one 2,000,000-record event leaves p95 and max at 10).
5. **Blocked or unapproved activity never trains the baseline** (§3).
6. **Gradual drift is absorbed.** Legitimate change, such as a new
   integration used every day, becomes normal within 2 days of regular use.

## 7. Deviations

Detected after the response for every recorded event, from `/events` and
from `/evaluate` decision rows. Attempts are compared too: a first-ever
destination is notable even if it was blocked.

**Recording.**
- Stored in `behavioral_deviations`, one row per (agent, kind, subject, UTC
  day).
- Repeats on the same day only increment `occurrences` and `lastSeenAt`.
- Every row records `baselineVersion`, `maturity`, `confidence`, and the
  first triggering `eventId`.

| Kind | Rule (ESTABLISHED unless noted) |
|---|---|
| `NEW_TOOL`, `NEW_DESTINATION`, `NEW_SERVICE`, `NEW_ACTION_TYPE`, `UNUSUAL_DATA_TYPE`, `UNUSUAL_SEQUENCE`, `NEW_END_USER` | value not established in the dimension (also LIMITED_HISTORY, at LOW confidence) |
| `UNUSUAL_VOLUME` | one event's records/bytes > max(3 × p95, largest non-outlier value), and ≥ 10 records / ≥ 1 MiB |
| `UNUSUAL_FREQUENCY` | learnable events in the event's hour > max(3 × p95, p95 + 20) of active hours, and ≥ 20 |
| `UNUSUAL_TIME` | activity in a UTC hour of day with zero activity across 14+ active days |

**Every deviation explains itself:**
- **WHAT changed:** `observed` (the value or count).
- **WHAT was expected:** `expected` (established values and shares, or
  median/p95/max/n, the threshold, and the window).
- **WHY it's unusual:** `explanation`, one sentence stating the rule and the
  numbers.

For example:

> Unusual volume: one event involved 48,000 records. Over the last 28 days
> this agent's events had a median of 10 and a 95th percentile of 10 records
> (largest: 10, n=360); anything above 30 (the larger of 3× the 95th
> percentile and the largest normal value) is flagged.

**Overlap with existing security detectors.** `NEW_TOOL_USAGE` and the
volume and spike alerts still exist as *security alerts*. P2 deviations are
the baseline-backed *behavioral record*. Consolidating alerting onto
deviations is a P3 (unified risk) decision.

## 8. Historical integrity

- **Baselines are immutable.** `agent_baselines` rows are append-only,
  enforced by the P1 trigger function (extended with an optional
  counter-columns argument). A historical baseline always reads exactly as
  computed, including `methodologyVersion` for its rules. Deleting source
  events doesn't change it (tested).
- **Deviation content is immutable.** In `behavioral_deviations`, only
  `occurrences` and `lastSeenAt` may change, plus `eventId` → NULL if that
  event is deleted. What changed, the explanation, the expected values, the
  baseline version, and the confidence are fixed (tested).
- **Rollups and behavior state are mutable** derived data, because they are
  recomputable from events.

## 9. API

**Endpoints.** All are `GET`. They require the **`behavior:read`** scope and
respect agent-bound keys (403 for another agent). Tenants are isolated: the
agent slug is resolved inside the key's organization.

| Endpoint | Returns |
|---|---|
| `/api/v1/agents/:slug/behavior` | current baseline metadata + maturity, full profile, last 7 days of deviations |
| `/api/v1/agents/:slug/behavior/baselines[?limit=]` | version history (metadata) |
| `/api/v1/agents/:slug/behavior/baselines?version=N` | one historical version, exactly as computed |
| `/api/v1/agents/:slug/behavior/deviations?days=&limit=` | recent deviations with explanations |
| `/api/v1/agents/:slug/behavior/history?days=` | one row per UTC day: events, records, bytes, distinct tools and destinations, deviations |

**Scope rollout.**
- New API keys get `behavior:read` by default.
- **Existing keys don't**, because P2 doesn't widen existing credentials.
  Granting it to existing keys is a product decision (below).

**Dashboard.** The dashboard uses the same library functions. Behavioral data
has the same visibility as security alerts (`view_security`).

## 10. UI

- **Agent overview → Behavior card:** maturity badge, what that means, the
  count of changes in the last 7 days, and a link.
- **Behavior tab:**
  - **Baseline:** maturity and its explanation, the learning window in UTC
    days, version, and when it was computed.
  - **What is normal:** established tools, services, destinations, data
    types, action types, actions, and policy decisions (share and days
    seen); events per active hour; active hours of day; records per event.
  - **What has changed:** deviations from the last 14 days with
    explanation, confidence, repeat count, and a link to the first event,
    plus the note that they don't block or alert.

## 11. Performance

**Measured locally** (WSL Postgres, in-process) for an agent with 28 days at
240 events/day: 6,720 events, half of them children with parent links.

| Operation | Time |
|---|---|
| First baseline of the day (rollups + profile) | **2.8 s**, once per agent per day, after the response or via cron |
| Cached baseline lookup | 4 ms |
| Per-event observation | median 40 ms, p90 44 ms; after the response |
| Stored profile | 5.4 KB / version |
| Rollup rows | 18,144 for 28 days |

**Query-plan fix found during measurement.** The parent→child (sequence)
rollup originally joined the parent with an organization predicate. Under
stale table statistics (right after a bulk insert) Postgres scanned the whole
organization once per child: **15–20 s** for this agent. The lookup is now
primary-key only, with the tenant check applied to the returned row
(`lib/behavior/rollup.ts`), bringing it to **2.8 s**.

**Decision and ingestion path.** Unchanged: all behavioral work is deferred
(`lib/server/defer.ts`); nothing synchronous was added to `/events` or
`/evaluate`.

## 12. Privacy

- **Profiles hold normalized keys:** tools, services, destination
  hosts/domains, data classes, action codes, and **end-user pseudonyms**
  (P1 HMACs, never raw ids).
- **They never hold** resource values, descriptions, metadata, or volumes per
  user.
- **End users in the UI.** The UI shows end users only as shares in
  explanations, never as a list.
- **End users in the API.** The profile API includes pseudonymous keys. These
  are linkable within an organization (that is their purpose) and not
  reversible without the key.
- **Deviation evidence** contains the same kinds of values.
- **Retention:**
  - rollups: 90 days
  - baselines and deviations: kept (they're history), and removed with their
    agent or organization
  - general retention enforcement is still not implemented (P0/P1
    limitation)
- **The cron endpoint is cross-tenant by design** and returns only counts.

## 13. Limitations

1. **Data quality.** Baselines reflect what agents report. A dimension the
   agent doesn't populate can't be profiled.
2. **UTC only.** Time-of-day uses UTC hours, with no per-agent time zone or
   weekday/weekend seasonality. Weekly patterns (e.g. month-end batch jobs)
   can produce `UNUSUAL_FREQUENCY` or `UNUSUAL_TIME` until they recur within
   the window.
3. **Fixed thresholds.** They are global constants, not tunable per org or
   agent, and there is no "mark as expected" feedback yet (P3).
4. **Daily learning cadence.** New legitimate behavior is flagged for at
   least 2 days.
5. **No alerts or decisions.** Deviations don't raise security alerts and
   don't affect decisions (by design in P2). Consumers must read them via UI
   or API.
6. **Best-effort observation.** If a deferred observation is lost (crash or
   `maxDuration`), that event is never compared. Rollups and baselines
   self-heal; missed deviations don't.
7. **Bounded volume sample** (most recent 20,000 values per window).
8. **Not verified against Neon**, as in P1.

## 14. Migration and deployment

**Migration `20261003120000_p2_behavioral_memory`:**
- Adds 2 enums (`BaselineMaturity`, `BehavioralDeviationKind`) and 4 tables:
  rollups, behavior state, baselines, deviations.
- Changes the `api_keys.scopes` *default* only (adds `behavior:read`).
- Replaces the append-only trigger function, backward compatible, and adds 2
  triggers.
- No data backfill: profiles are computed lazily from existing events.

**New environment variable:** `CRON_SECRET` (optional; enables the daily
pre-computation cron).

**New file: `vercel.json`.**
- Contains one daily cron. A daily schedule is valid on every Vercel plan.
- Without `CRON_SECRET`, the endpoint returns 503 and the cron does nothing.

## Product decisions needed

1. Grant `behavior:read` to existing API keys, or require new keys?
2. Should established-baseline deviations become security alerts now, or wait
   for P3?
3. Per-agent time zones and weekly seasonality: build them, or keep UTC
   hour-of-day only?
4. Should thresholds be per-org tunable?
5. How long to keep baselines and deviations?
