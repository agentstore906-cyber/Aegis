# Cost intelligence (Phase 5)

This document covers `lib/costs/` and the `/costs` dashboard.

## Why there's no `CostEvent` table

Cost data (`costCents`, and now `inputTokens`/`outputTokens`/`taskId`/
`taskType`) lives on `ActivityEvent`, the same row Activity and Audit
already query — not a separate event-store table. Two reasons:

1. **No duplication.** Every priced action is already an `ActivityEvent`
   (created either by `evaluateAgentAction()` or `POST /api/v1/events`). A
   parallel `CostEvent` table would mean writing the same fact twice and
   keeping the two in sync forever.
2. **Query-time aggregation is enough at this scale.** `lib/costs/queries.ts`
   is entirely `SUM`/`groupBy` aggregates over `ActivityEvent`'s existing
   `[organizationId, timestamp]` / `[agentId, timestamp]` indexes. If
   `ActivityEvent` volume ever makes these slow, the first thing to add is
   a daily rollup table populated by a scheduled job — not a bigger event
   store. That's a deliberate "not yet," not an oversight.

`costCents` is an integer (cents), not a float — the same precision
choice the schema already made in Phase 1. `getSpendSummary`'s test
(`lib/costs/__tests__/queries.integration.test.ts`) specifically asserts
sums land on exact integers, not `832.9999999998`.

## Cost anomalies are security alerts

A cost spike (`COST_SPIKE`) is created and stored exactly like any other
detector finding in `SecurityAlert` — see `docs/security-intelligence.md`.
There is deliberately no second, parallel anomaly system: the `/costs`
page's "Cost anomalies" section is just `listSecurityAlertsByType(org,
"COST_SPIKE")`.

## Time windows (UTC)

All aggregation in `lib/costs/queries.ts` uses UTC month/day boundaries
(spec §34) — `startOfUtcMonth()` / `startOfUtcDay()`. Only the UI
localizes for display. `getTrailingDailyAverageCentsForAgent()` excludes
today from its own average, so a spike day can't dilute the baseline it's
being measured against.

## Cost-per-successful-task

`getCostPerSuccessfulTaskForAgent()` groups an agent's `taskId`-tagged
events for the current month, sums cost per `taskId`, and averages across
tasks that had at least one `ALLOWED` event under them (the "successful"
heuristic — a task with only `FAILED`/`BLOCKED` events isn't counted).
Returns `null` — never a fabricated number — when the agent has no
`taskId`-tagged data at all; the UI renders "Not enough data" in that
case (spec §12).

`taskId`/`taskType` are optional SDK/API fields (see `docs/api.md`) — an
agent that never sets them simply won't have this metric, gracefully.

## What Phase 5 deliberately doesn't do

- No currency other than USD, no per-org currency setting.
- No hard spend limits / automatic blocking on budget — alerting only
  (spec §14). A future hard-budget control would route through the Policy
  Engine, not a separate cost-limiting system.
- No cost-per-tool breakdown — `ActivityEvent` doesn't carry a dedicated
  tool identifier (see `docs/security-intelligence.md`'s note on the same
  gap for `NEW_TOOL_USAGE`).
