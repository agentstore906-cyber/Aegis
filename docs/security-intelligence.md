# Security intelligence (Phase 5)

This document covers `lib/security/` — the `SecurityAlert` model and the
detectors that populate it. Every claim here is checkable against
`lib/security/detectors.ts`; there is no separate scoring model to keep in
sync with this document.

## Principle

Aegis does not claim AI threat detection. Every detector is deterministic
or statistical, over structured data Aegis already has (`ActivityEvent`,
`PolicyEvaluation`). Every alert answers four questions (spec §35):

1. **What happened?** — `title`
2. **Why is this unusual?** — `description`
3. **What evidence triggered it?** — `evidence` (redacted JSON)
4. **What should I inspect next?** — Security Alert Detail links related
   activity, related policy evaluations, the agent, and (for cost
   anomalies) the Costs page.

Language is deliberately hedged where causation isn't proven: cost-spike
descriptions say "likely contributor" and "detected pattern," never
"caused by."

## Detectors and severity rules

| Detector | Type | Trigger | Severity |
|---|---|---|---|
| New sensitive action | `NEW_SENSITIVE_ACTION` | First-ever use of this exact action by this agent, and risk is HIGH/CRITICAL | HIGH, or **CRITICAL** if the attempt was blocked or the risk itself is CRITICAL |
| Block spike | `BLOCK_SPIKE` | More than 5 blocked actions for one agent in 15 minutes | HIGH |
| Failure loop | `FAILURE_LOOP` | The same action fails ≥3 times for one agent within 5 minutes | MEDIUM |
| New tool usage | `NEW_TOOL_USAGE` | First-ever action in a given `namespace.*` for this agent (namespace = the part of the action before its first `.`; the whole action if there's no dot) | LOW |
| High-risk burst | `HIGH_RISK_BURST` | ≥3 HIGH/CRITICAL-risk actions for one agent within 10 minutes | HIGH |
| Cost spike | `COST_SPIKE` | Today's spend for an agent ≥3× its trailing 7-day daily average, with a $1 minimum floor so idle agents don't trip on trivial spend | HIGH |

`NEW_TOOL_USAGE`'s namespace heuristic is an honest approximation, not real
tool-call instrumentation — ingested events don't carry a dedicated tool
identifier (see `docs/cost-intelligence.md`'s note on the same limitation
for cost breakdowns by tool).

`COST_SPIKE` is deliberately just another entry in this table, not a
separate anomaly system — see `docs/cost-intelligence.md`.

## Deduplication (spec §6)

A repeat trigger of the same `(agentId, type)` against an `OPEN` alert
created within the last 24 hours updates that alert's `count` and
`lastSeenAt` instead of creating a new row (`lib/security/repository.ts#upsertAlertFinding`).
Only the first, genuinely new alert is audit-logged and dispatched to
webhooks — repeat triggers update the existing row silently, so
acknowledging or resolving one alert's history stays readable instead of
one line per repeat trigger.

If an alert of the same type is later resolved, the *next* trigger starts
a fresh dedup lineage (a new `SecurityAlert` row) — a resolved alert never
silently reopens.

## Where detectors run

Called inline (spec §32's "service hook" model, no queue) from the two
places activity already flows through: `lib/policies/evaluate.ts` (after
persisting a policy evaluation) and `lib/activity/ingest.ts` (after
persisting an externally-reported event). Both call
`lib/security/evaluate.ts#runSecurityDetectors()`, which:

- Runs the activity-triggered detectors (new sensitive action, new tool,
  block spike, high-risk burst, and — only when the triggering event
  itself failed — failure loop) using short, indexed-window queries.
- Always also runs the cost-spike check. Two indexed, week-scoped
  `SUM` aggregates per event is cheap enough to run inline; alert spam is
  prevented by the 24h dedup window above, not by throttling how often the
  check itself runs.
- **Never throws.** A detector failure is logged and swallowed — it must
  never break the activity/evaluation flow it's piggybacking on.

The one query that isn't window-scoped is the "has this agent ever done
this exact action / namespace before" existence check — that's inherently
a full-history question. It's backed by the `[agentId, action]` index
added alongside this feature (`prisma/schema.prisma`), not a full scan.

## Authorization

`lib/security/authorization.ts`, delegating to `lib/rbac/capabilities.ts`
— see `docs/rbac.md`. Viewing alerts is available to every role; resolving
them is `OWNER`/`ADMIN`/`SECURITY` only.

## What Phase 5 deliberately doesn't do

- No machine learning, no opaque risk scoring.
- No automated remediation — "Pause agent" from an alert is a real,
  explicit action a human takes, never automatic.
- No retention enforcement — see `docs/retention.md`.
