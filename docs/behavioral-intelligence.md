# Behavioral intelligence (Phase 2)

This document covers `lib/security/baseline.ts` and `lib/security/risk-score.ts`
— the pieces that answer "is this agent's *current* behavior normal for
*this* agent?" Both build on the Phase 1 `ActivityEvent` model and the
Phase 5 detector/`SecurityAlert` system (`docs/security-intelligence.md`);
neither introduces a new event model or a parallel anomaly system.

## Behavioral baseline (`lib/security/baseline.ts`)

`getAgentBehavioralBaseline(organizationId, agentId)` computes what
"normal" looks like for one specific agent, from that agent's own trailing
7-day history — deliberately per-agent, not a fleet-wide average. Two
agents doing different jobs have no reason to share a definition of
normal.

Metrics: events/day, tool calls/day, model calls/day, data-access/day,
destructive (delete-shaped) actions/day, communications/day, failed/day,
blocked/day, and cost/day when the agent has ever reported cost.

**Insufficient data.** Below 10 observed events or 3 observed days, the
function returns `{ available: false, eventsObserved, daysObserved }`
rather than a number computed from too little history. The UI
(`components/security/behavioral-baseline.tsx`) renders this as
"Insufficient data" with the actual observed counts — never a baseline
padded out from nothing.

**Why some spec metrics are merged, not separated.** The spec's example
metric list includes "API requests," "database reads," and "database
writes" as if they were distinct signals. `ActivityEvent` (Phase 1) does
not structurally separate reads from writes, or distinguish "an API
request" from any other reported event — every event *is* an API request
in the sense that it arrived via `POST /api/v1/events` or an internal
policy evaluation. Rather than inventing a new taxonomy on top of Phase
1's `ActivityType` enum (which the Phase 1 principle explicitly says not
to rewrite), these fold into `eventsPerDay` (total volume) and
`dataAccessPerDay` (the `DATA_ACCESS` event type, reads and writes
together). "Deletes" and "communications" *are* separated, because they
map cleanly onto real, existing signals: `DELETE_KEYWORDS`-matched
action/resource text, and the `COMMUNICATION` event type, respectively.

**Sensitive-resource and delete keyword lists live in one place.**
`lib/security/risk-scoring.ts` exports `SENSITIVE_RESOURCE_KEYWORDS` and
`DELETE_KEYWORDS` as arrays (not just derived regexes), so both the
in-memory per-event scorer and this file's Prisma `contains` filters
recognize "sensitive" / "destructive" identically — one vocabulary, not
two that can drift apart.

## Anomaly detection extensions (`lib/security/detectors.ts`)

Phase 2 adds three detectors, same shape as Phase 5's `COST_SPIKE` /
`ACTIVITY_VOLUME_SPIKE` (today's count vs. this agent's own trailing
7-day daily average, never a fleet-wide or absolute threshold, never
firing without a real baseline):

| Detector | Type | Trigger | Severity |
|---|---|---|---|
| Data access spike | `DATA_ACCESS_SPIKE` | Today's `DATA_ACCESS` count ≥4× the trailing daily average, floor of 5 | HIGH |
| Delete activity spike | `DELETE_ACTIVITY_SPIKE` | Today's delete-keyword-matched count ≥3× the trailing daily average, floor of 3 | HIGH |
| External communication spike | `COMMUNICATION_SPIKE` | Today's `COMMUNICATION` count ≥4× the trailing daily average, floor of 5 | MEDIUM |

These extend the table in `docs/security-intelligence.md`, which remains
the canonical list of every detector and its severity rule.

## Agent Risk Score (`lib/security/risk-score.ts`)

`computeAgentRiskScore(signals)` is a pure, deterministic function: a set
of named, bounded-point factors summed and capped at 100. Every factor
that contributes points appears in the returned `factors` list with a
plain-English label — there is no factor that silently changes the score
without being named. This is explicitly **not** the opaque scoring
`docs/security-intelligence.md` says Phase 5 deliberately avoids — every
point is traceable to one rule, same philosophy as
`lib/security/risk-scoring.ts`'s per-event scorer.

Factors (points, capped where noted):

- **Configured risk classification** — the agent's own `riskLevel`: LOW 0, MEDIUM 8, HIGH 20, CRITICAL 35.
- **Open security alerts by severity** — CRITICAL 15/alert (cap 30), HIGH 8/alert (cap 24), MEDIUM 3/alert (cap 9).
- **New capability** — an open `NEW_SENSITIVE_ACTION`/`NEW_TOOL_USAGE` alert: flat 6 points (a data point, not by itself a red flag).
- **Blocked actions (7d)** — tiered: 1-4 events → 6, 5+ → 14.
- **Policy violations (7d)** — `PolicyEvaluation` rows with `decision: BLOCK`: same tiering as blocked actions.
- **Failed actions (7d)** — tiered: 1-4 → 4, 5+ → 10.
- **Destructive actions (7d)** — delete-keyword-matched: tiered 1-2 → 5, 3+ → 12.

`lib/security/repository.ts#getAgentRiskScore(organizationId, agent)` is
the only place that queries the database for these signals — six bounded,
indexed-window queries for one agent, never a loop over agents. The
dashboard's "High-risk agents" list (`getHighRiskAgentsSummary`)
deliberately does **not** compute the full score for every agent in an
org — that would be N extra queries per dashboard load. It ranks agents
by open HIGH/CRITICAL alert volume instead (two bounded `groupBy`
queries), a cheap proxy for the same underlying signal.

### Blocked actions vs. policy violations — not double-counted by accident

`blockedActions7d` counts `ActivityEvent` rows with `status: BLOCKED`
(any source — including an agent self-reporting that its own guardrail
stopped it). `policyViolations7d` counts `PolicyEvaluation` rows with
`decision: BLOCK` (Aegis's own policy engine denying the action before it
happened). `evaluateAgentAction()` (Phase 3) creates one of each for a
BLOCK decision, so these two factors *can* both fire from the same
underlying event — that mirrors the spec's own example reasons list
("elevated delete activity" and "repeated policy violations" as separate
bullets), not an accidental double-count of unrelated things.

### The `source` field now means what Phase 1 always said it did

`ActivityEvent.source` was documented ("api" for a directly-reported
event, "policy_evaluation" for one created inline by
`evaluateAgentAction()") but `lib/policies/evaluate.ts` never actually set
it — every event defaulted to `"api"` regardless of origin. Fixed as part
of this phase (one line: `source: "policy_evaluation"` on that `create()`
call) because accurate provenance is what lets `blockedActions7d` and
`policyViolations7d` above mean what their names say.

## Agent Health

The Agent Health section of an agent's Overview tab now shows, top to
bottom: **Risk score** (the number + its reasons), **Behavioral
baseline** (per-day metrics or "Insufficient data"), then the existing
Phase 5 "Agent health" card (open alerts, cost/activity anomaly flags,
24h counts) — unchanged.

## What Phase 2 deliberately doesn't do

- No machine learning. Every baseline number and every risk-score point
  traces back to a real, named query or rule.
- No org-wide or fleet-wide "normal" — every baseline is one agent's own
  history, never compared across agents.
- No automatic action on a high risk score. The score is a signal for a
  human to act on (or configure a policy around), never something that
  pauses or blocks an agent by itself.
