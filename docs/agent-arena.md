# Agent Arena

Agent Arena is an **additive, fully isolated** feature that turns Aegis's
existing agent connection into a viral loop:

```
Connect Agent → Test → Score → Share → Challenge → Connect Agent → …
```

It does not create agents, does not add a second connection system, and does
not touch any existing table, enum, route, or component. It benchmarks an
agent **you already connected to Aegis**, using the data Aegis already has.

## Where it lives

| Path | Purpose |
| --- | --- |
| `/arena` | Dashboard landing — "Put Your Agent to the Test." Lists connected agents with **Test My Agent**, past scorecards, and the viral metrics. |
| `/arena/[id]` | A scorecard (owner view) — overall score, category breakdown, the probe results, and sharing controls. |
| `/a/[slug]` | The **public** scorecard — score and categories only. Dynamic Open Graph image + metadata. |
| `/a/[slug]/challenge` | "Challenge This Agent" entry point — records attribution in a cookie, routes to sign-up or `/arena`. |

Nav entry: **Agent Arena**, added to `lib/dashboard-nav.ts` (between Agents
and Activity).

## The benchmark

`lib/arena/benchmark.ts#runArenaBenchmark` produces a **real, deterministic**
score from `0`–`1000` (e.g. `847 / 1000`). It is never random and never
hand-entered. Two independent signals feed it:

### 1. Probe suite (`lib/arena/scenarios.ts`)

~20 synthetic scenarios across **Security**, **Tool Safety**,
**Prompt-Injection Resistance**, and **Policy Compliance**. Each is evaluated
against the agent's *real* Aegis configuration — its `AgentPermission` rows
and active `Policy` rows — using the **pure** resolver functions
(`resolveBestPermission`, `filterApplicablePolicies`, `resolveDecision`).

This path **never** calls `evaluateAgentAction()`, so it:

- writes no `ActivityEvent` / `PolicyEvaluation`
- creates no `ApprovalRequest`
- fires no webhook
- runs no security detector

The "dangerous tools" (`email.send_bulk`, `db.table.drop`,
`payment.transfer`, …) are **strings in a data structure**. Nothing is sent,
deleted, transferred, deployed, or exposed. An unconfigured agent fails
closed (everything `BLOCK`ed), which scores well on "should block" probes and
poorly on the few "should allow" probes — so a real score requires real
governance, not an empty config.

### 2. Observed telemetry

**Reliability**, **Task Performance**, **Cost**, **Latency**, and part of
**Security** are computed from the agent's existing `ActivityEvent` history
(status mix, `durationMs`, `costCents`, `taskId` outcomes) and its open
`SecurityAlert` count. Read-only, org-scoped, bounded to the most recent
1,000 events. Categories with too little data fall back to a neutral
baseline and are flagged "limited data".

### Scoring (`lib/arena/scoring.ts` — pure, unit-tested)

Each category is `0`–`100`. Where both signals exist, probe is weighted
`0.6` and telemetry `0.4`. The overall score is the weighted mean of the
eight categories (`ARENA_CATEGORY_WEIGHTS`, summing to 1) × 10.

## Privacy

The public scorecard (`lib/arena/share.ts#PublicScorecard`) is a projection
that *by construction* has no field for anything identifying. It exposes
**only**: overall score, the eight category scores, a benchmark version, a
published date, and a user-chosen display label (sanitised, default
"Anonymous Agent").

It never exposes API keys, credentials, prompts, source, customer/CRM data,
internal URLs, conversations, tool outputs, agent name/slug, model, policies,
activity, or internal IDs. The public URL is keyed by an unguessable
`publicSlug`, not the scorecard's primary id. Scorecards are **private by
default** and only become public on an explicit **Make Scorecard Public**
action.

## Challenge flow

1. Visitor opens `/a/[slug]` and clicks **Challenge This Agent**.
2. `/a/[slug]/challenge` creates an `ArenaChallengeAttribution` row and drops
   its token in the `aegis_arena_challenge` cookie (7 days, httpOnly).
3. Signed-out visitors go to `/sign-up`; the cookie survives the round trip.
4. Back on `/arena`, `getPendingChallenge()` reads the cookie and shows the
   "you're challenging X" banner.
5. When they run a benchmark, `startBenchmarkAction` links the new scorecard
   (`challengedFromId`), marks the attribution converted, and the scorecard
   shows **You beat 847.** / **847 still wins.**

## Analytics & viral metrics

`lib/arena/analytics.ts#trackArenaEvent` persists funnel events to
`arena_analytics_events` (the app-wide `lib/analytics/track.ts` is a
dev-only console stub, so Arena keeps its own persisted log).

Events: `arena_viewed`, `benchmark_started`, `benchmark_completed`,
`score_generated`, `scorecard_viewed`, `scorecard_shared`,
`scorecard_made_public`, `challenge_created`, `challenge_clicked`,
`challenge_completed`, `challenge_signup`, `connect_agent_from_challenge`.

`lib/arena/metrics.ts#getArenaViralMetrics` derives, from real data:

- **Challenge Rate** — challenges created ÷ public scorecard views
- **Challenge Conversion** — challenges that produced a real competing score
- **Viral K-Factor** — (challenges per public scorecard) × conversion

## Database

Migration `20260903120000_add_agent_arena` — **additive only**: one new enum
(`ArenaScorecardStatus`) and four new tables (`arena_scorecards`,
`arena_scenario_results`, `arena_challenge_attributions`,
`arena_analytics_events`). No existing table, column, enum, constraint, or
row is touched.

The arena models deliberately hold **no Prisma relations and no database
foreign keys into `Organization`, `Agent`, or `User`** — only plain scalar
`organizationId` / `agentId` columns with indexes. Arena is a self-contained
layer; it never constrains a legacy table. (Agents/orgs are never deleted in
this codebase; if that changes, the delete path must decide what to do with
arena rows explicitly.)

## What it is not

No marketplace, no "Create Agent", no global leaderboard, no social graph, no
comments, no referral payments, no gamification. V1 is exactly the loop.
