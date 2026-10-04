# Aegis P3 — Agent Trust

**Status:** implemented and verified locally on 2026-10-04. **Not deployed.**
P3 builds on P0, P1, and P2, which are also uncommitted and undeployed.

**Goal:** give every agent a dynamic, explainable trust state that answers
*"what is this agent's current trust state?"* and *"why?"*.

**Scope:**
- Trust is **accumulated evidence** about an agent's current operating state.
  It is not a rating, a model output, or a cosmetic number: every point of the
  score traces to a specific piece of evidence (with ids), and every change
  has recorded reasons.
- Trust is **informational in P3.** It blocks nothing, changes no
  `/evaluate` decision, and raises no alert (tested: a DEGRADED agent with an
  ALLOW permission is still allowed). Connecting trust to the Unified Risk
  Engine is the next stage.

**Migration:** `prisma/migrations/20261004120000_p3_agent_trust/`.

## Verification

All runs used the local disposable database `localhost/aegis_test`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` (P3 files and every file touched) | 0 problems |
| `npm test` (no test DB, unit tests only) | **48 files, 469 tests, all passed** |
| Full suite (`DATABASE_URL_TEST=…/aegis_test`) | **74 files, 782 tests, all passed** |
| `npx next build` | compiled; 3 API routes added |
| `prisma migrate diff` after `migrate deploy` | no drift between the migration and `schema.prisma` |
| Mutation check: advisory lock removed | caught (concurrency test failed) |
| Mutation check: kill-switch refusals counted as evidence | caught |
| Mutation check: recovery margin set to 0 | caught (2 tests failed) |

**New tests: 65.**
- `lib/trust/__tests__/score.test.ts` (27): initialization, degradation,
  caps, repeated incidents, decay and recovery, hysteresis, explanations.
  Pure; runs without a database.
- `components/trust/__tests__/trust-view.test.tsx` (4)
- `lib/__tests__/p3-agent-trust.integration.test.ts` (34): initialization,
  degradation and recovery with an explicit clock, the real ingestion /
  evaluation / approval / alert / kill-switch paths, concurrency, historical
  integrity, tenant isolation, authorization, API contracts, and the cron.

---

## 1. Model

```
evidence (all already in Aegis)                      trust computation (pure)
──────────────────────────────                       ────────────────────────
behavioral_deviations  (P2)    ─┐
policy_evaluations BLOCK/ALERT ─┤  per-item points                       score = 100 − Σ capped category penalties
security_alerts (7 types)      ─┼─ × severity/confidence × recency ──►   ceiling for insufficient history
approval_requests REJECTED     ─┤  (linear fade to 0 over its window)    state = thresholds + recovery margin
agent status (pause/stop)      ─┤                                         (operator pause/stop → RESTRICTED)
agent age + baseline maturity  ─┘
                                                     │
              evaluateTrust() — one transaction under a per-agent advisory lock
                                                     ▼
        agent_trust_states         (current state, mutable cache of the latest evaluation)
        agent_trust_transitions    (append-only history: one row per meaningful change)
```

**Why a score at all.** The score is the sum of itemized penalties. It exists
so that "how much worse" and "recovering" have a number, and so changes can be
shown as `94 → 82 → 61`. It is never shown without the itemization behind it,
and it is **not** a prediction or a probability.

**Why states.** The five states are the decision-ready summary. Every state
change carries the reasons for it.

## 2. States and thresholds

All numbers live in `lib/trust/config.ts` and are versioned
(`TRUST_METHODOLOGY_VERSION`, stored on every transition).

| State | Entered when |
|---|---|
| **TRUSTED** | score ≥ 85 |
| **NORMAL** | score 60–84 |
| **DEGRADED** | score 40–59 |
| **HIGH_RISK** | score 20–39 |
| **RESTRICTED** | score < 20, **or** an operator paused or stopped the agent (or it is archived) |

These thresholds are **product choices, not derived facts.** They aren't
fitted to data; there's no incident corpus yet to fit them to. They are
written down so they can be reviewed and changed deliberately (a change bumps
the methodology version).

**Hysteresis.** Moving to a **better** state needs the threshold **plus 5
points**, so a score hovering on a boundary can't flap between states.
Moving to a worse state has no margin: degradation is never delayed.

**Restricted by operator.** A paused/stopped agent is RESTRICTED regardless
of its evidence, with the reason "an operator paused/stopped this agent". The
evidence score is still computed and shown. When the agent is resumed, trust
returns to what its evidence supports (subject to the recovery margin).

## 3. Signals: what is used and what isn't

| Signal | Used? | How |
|---|---|---|
| **Behavioral deviations** (P2) | ✅ `behavior` | one factor per deviation; 7-day window |
| **Policy violations** (`ALERT`-decision policy matched) | ✅ `violations` | 5 points each; grouped per action; 7 days |
| **Blocked actions** (`BLOCK`) | ✅ `blocked` | policy block 6, no-permission attempt 4; grouped per action; 7 days |
| **Historical incidents / security alerts** | ✅ `alerts` | 7 alert types; by severity and status; 30 days |
| **Approval history** | ✅ `approvals` | rejected requests, 4 each; 14 days. Approved, expired, and cancelled requests are not evidence either way |
| **Operator control** | ✅ limit | pause/stop/archive → RESTRICTED |
| **Agent age + baseline maturity** | ✅ limit | cap below TRUSTED until 14+ days **and** an ESTABLISHED baseline |
| **Recent activity** | ➖ | not a penalty. Silence is not distrust. Activity counts only through the evidence it generates |
| **Environment, risk level, permissions** | ❌ | static configuration, not observed behavior. They describe *exposure*, which is the unified risk engine's input. Mixing them in would make trust double as a risk score |
| **Identity** | ❌ | Aegis doesn't record failed key attempts or key-agent mismatches as events yet. Nothing reliable exists to use |
| **Kill-switch refusals** | ❌ excluded | a `BLOCK` with `decisionSource = CONTROL` is the operator's decision, not the agent's behavior |

### Deviation weights

Points at full strength, before confidence, repeats, and decay.

| Deviation | Points |
|---|---|
| New destination, unusual data type, unusual volume | 10 |
| Unusual sequence, new tool, unusual frequency | 6 |
| New service | 5 |
| New action type | 4 |
| Unusual time | 3 |
| New end user | 2 |

- **Confidence multiplier:** LOW × 0.4 · MEDIUM × 0.75 · HIGH × 1.
  LIMITED_HISTORY baselines only claim LOW confidence, so a young agent's
  deviations weigh less.
- **Repeats:** each repeat on the same day adds 10%, up to × 1.5. This is
  how a **repeated incident** weighs more than a single one.

### Alerts: no double counting

Only alert types with **independent** evidence count: `NEW_SENSITIVE_ACTION`,
`FAILURE_LOOP`, `HIGH_RISK_BURST`, `DATA_ACCESS_SPIKE`, `DELETE_ACTIVITY_SPIKE`,
`COMMUNICATION_SPIKE`, `POLICY_VIOLATION_DETECTED`, `ACTIVITY_WHILE_HALTED`,
`PROMPT_INJECTION_INDICATOR`, `CREDENTIAL_EXPOSURE_DETECTED`.

**Excluded**, each for a stated reason:
- `POLICY_ALERT` and `BLOCK_SPIKE`: already scored from the policy
  decisions themselves.
- `NEW_TOOL_USAGE` and `ACTIVITY_VOLUME_SPIKE`: overlap the P2 deviations
  `NEW_TOOL` and `UNUSUAL_FREQUENCY`.
- `COST_SPIKE`, `BUDGET_*`: operational, not trust-relevant.

Severity points: LOW 3 · MEDIUM 8 · HIGH 15 · CRITICAL 25.
Status multiplier: OPEN × 1 · ACKNOWLEDGED × 0.75 · RESOLVED × 0.25.

### Caps

Each category can subtract at most this much, so one noisy source can't
zero the score by itself (a retry loop hitting the same block 1,000 times
costs 30, not 6,000).

| Category | Window | Cap |
|---|---|---|
| Behavioral deviations | 7 days | 40 |
| Blocked actions | 7 days | 30 |
| Policy violations | 7 days | 20 |
| Security alerts | 30 days | 45 |
| Rejected approvals | 14 days | 12 |

When a category is capped, its factors are scaled down proportionally so the
listed points always add up to what was actually applied, and the UI says so.

### Insufficient history

Until the agent is **14+ days old** and has an **ESTABLISHED** P2 baseline,
the score is capped at **84** (NORMAL). The reason is shown as a limit. A new
agent therefore starts **NORMAL, not TRUSTED**: no bad evidence is not proof
of good behavior. It reaches TRUSTED by accumulating a clean, observed
history, with no action needed. Trust only *reads* the latest baseline row; it
never computes one.

## 4. Recovery

**Every penalty fades linearly to zero over its window**, so an agent that
returns to normal recovers by itself:

```
10-point deviation, 7-day window:   now 10 → +3.5 days 5 → +7 days 0
```

Tested end to end with an explicit clock: an agent hit by an incident drops
to DEGRADED (54), recovers to NORMAL (77) half a window later, and to
TRUSTED (100) after a week, with each step recorded.

- **No permanent punishment.** Nothing in P3 is permanent. Even an open
  CRITICAL alert drops out after 30 days. Resolving an alert reduces its
  weight to a quarter immediately.
- **Repeat incidents** (same behavior again after recovery) degrade again,
  at full weight, as new history rows.
- **No policy-configured permanence exists.** The brief allows permanent
  restriction "if explicitly configured by policy". P3 doesn't provide that
  option (see the decisions below).
- **Recovery without events.** Time-based recovery needs evaluations, which
  come from (a) any trigger, (b) a read that finds the stored evaluation
  older than 10 minutes, and (c) the daily cron (§7).

## 5. Trust changes, reasons, and history

**What triggers an evaluation** (all after the response, except operator
control; none sit on the decision path):

| Trigger | When |
|---|---|
| `ACTIVITY_EVENT` | an ingested event produced deviations |
| `POLICY_EVALUATION` | an `/evaluate` decision was BLOCK (not by the kill switch) or ALERT, or produced deviations |
| `APPROVAL_DECISION` | a human rejected an approval |
| `SECURITY_ALERT` | a trust-relevant alert was raised, recurred, acknowledged, or resolved |
| `OPERATOR_CONTROL` | the agent was paused, stopped, or resumed (awaited, so the UI reflects it immediately) |
| `SCHEDULED` | the daily cron |
| `ON_DEMAND` | a read found no evaluation or a stale one |

Evaluation is **idempotent and order-independent**: the result depends only
on the evidence and the clock, never on which trigger got there first.

**What is recorded.** A history row is written for **initialization**, any
**state change**, or a **score move of 5+ points** since the last recorded
row. Smaller drift updates the current state without adding history.

Each transition stores:
- `occurredAt`, `previousState` → `newState`, `previousScore` → `newScore`
- `trigger` and `triggerRef` (the event, evaluation, approval, or alert id;
  no foreign key, on purpose)
- `summary`: the reason, in a sentence
- `factors`: a **snapshot** of every factor in force, with points and
  evidence ids
- `changes`: what was added, removed, increased, or decreased since the
  previous row
- `methodologyVersion`

Example summaries:

> Trust degraded from Trusted to Normal (100 → 75) because New destination:
> evil.example.com; Unusual data volume (records); Policy violation on
> export.data (1 time).

> Trust recovered from Degraded to Normal (54 → 77) because these no longer
> weigh as much: New destination: evil.example.com; …

> Trust degraded from Trusted to Restricted (100 → 100) because an operator
> restricted the agent.

State changes also write an `agent.trust_changed` audit event.

## 6. Historical integrity

- **Append-only.** `agent_trust_transitions` has a database trigger (the
  P1/P2 `aegis_enforce_append_only` function) that rejects any `UPDATE` to
  any column. Tested for state, score, summary, factors, and trigger
  reference, plus `updateMany`.
- **Self-contained.** Each row snapshots its factors, so history stays
  readable and unchanged after the source evidence is deleted (tested:
  deleting the deviations leaves the old row byte-for-byte identical, and
  recovery is a **new** row).
- **Chained and gapless.** `sequence` is gapless per agent; each row's
  previous state and score equal the prior row's new state and score
  (tested). `unique(agentId, sequence)` is the backstop (tested).
- **Concurrency.** Evaluation runs in one transaction under a per-agent
  advisory lock. 12 simultaneous evaluations produce one transition, and a
  second burst after new evidence produces exactly one more (tested).
- **Current state is mutable by design** (`agent_trust_states`): a cache of
  the latest evaluation. The evidence of record is the transition table.

## 7. API

All `GET`. Scope **`trust:read`**; agent-bound keys are limited to their own
agent (403 otherwise); the agent is resolved inside the key's organization.
Details in `docs/api.md`.

| Endpoint | Answers |
|---|---|
| `/api/v1/agents/:slug/trust` | the current state, score, since when, and a one-sentence reason |
| `/api/v1/agents/:slug/trust/reasons` | every factor with points and evidence ids, limits, category totals and caps, and the thresholds |
| `/api/v1/agents/:slug/trust/history?limit=&before=` | transitions, newest first, paged |

**Scope rollout.** New keys get `trust:read` by default. **Existing keys
don't**, as in P2: P3 doesn't widen existing credentials.

**Dashboard.** Same library functions; visibility is the same as security
alerts (`view_security`).

**Tenant isolation.** Every read takes the organization from the session or
key, never from input, and returns null (404) for another tenant's agent.
Tested: cross-tenant reads return the same 404 as a missing agent, the same
slug in two tenants resolves to each tenant's own evidence, and library calls
with a foreign agent id read and write nothing.

## 8. UI

- **Agent overview → Trust card:** state, score, the one-sentence reason,
  and a link.
- **Trust tab:**
  - **Current trust:** state, score, how long in this state, and when it was
    last evaluated; the reason; a statement that trust is informational.
  - **Why:** limits (operator control, insufficient history) and every
    factor with its category, recency, and points; notes when a category is
    capped or smaller factors are omitted.
  - **History:** each transition, with direction, scores, states, trigger,
    time, and the reason.
  - **How states are decided:** thresholds, the recovery margin, and how
    fast evidence fades.

No badges to collect, streaks, or rankings: only the state and its evidence.

## 9. Performance and cost

- An evaluation is one transaction: 6 indexed, bounded reads (at most 200
  deviations, 200 policy decisions per kind, 100 alerts, 100 approvals), one
  advisory lock, and 1–3 writes.
- Trust runs after the response, and **only** for events that are evidence
  (deviations, BLOCK/ALERT decisions, relevant alerts, rejections).
  Ordinary allowed activity costs nothing extra.
- A burst of 1,000 blocked calls triggers 1,000 evaluations (each cheap, and
  serialized per agent). There's no coalescing yet, because skipping a
  trailing evaluation could miss the last event. See limitations.

## 10. Limitations

1. **Thresholds and weights are judgment, not fitted.** There's no labeled
   incident data yet. They are explicit and versioned, but not validated.
2. **Global constants.** Not tunable per organization or agent.
3. **No operator feedback yet.** "Mark as expected" doesn't exist, so an
   agent whose legitimate new integration is flagged keeps the penalty until
   it fades (≤ 7 days) or the baseline absorbs it (2+ days of regular use).
4. **Best-effort triggers.** As in P2, deferred work can be lost if a process
   dies. Reads and the daily cron re-evaluate, so trust self-heals; a missed
   *transition* is recorded at the next evaluation, with that later trigger.
5. **Quiet agents recover on the next read or cron.** The cron is daily, so
   without reads, recovery can lag up to a day.
6. **`NEEDS_ATTENTION` is ignored.** Only PAUSED/STOPPED/ARCHIVED restrict.
7. **Identity isn't a signal** (§3).
8. **Evidence is bounded per source** (§9); beyond the caps the category cap
   would apply anyway.
9. **Alerts are matched by type.** A custom alert type added later is
   excluded until added to `TRUST_ALERT_TYPES`.
10. **Not verified against Neon**, as in P1/P2.

## 11. Migration and deployment

**Migration `20261004120000_p3_agent_trust`:**
- Adds 2 enums (`TrustState`, `TrustTrigger`) and 2 tables (current state,
  append-only transitions).
- Changes the `api_keys.scopes` *default* only (adds `trust:read`).
- Adds one trigger reusing the P1/P2 function.
- No backfill: an agent's trust is computed from its existing evidence on
  first evaluation (first trigger, read, or cron).

**No new environment variable.** The existing `CRON_SECRET` cron now also
re-evaluates trust (response gained a `trust` object with counts only).

## Product decisions needed

1. Grant `trust:read` to existing API keys, or require new keys?
2. Are the thresholds (85 / 60 / 40 / 20), the 14-day history requirement,
   and the weights right for your risk appetite?
3. Should a **permanent restriction** be configurable (e.g. an explicit
   per-agent "hold until reviewed" that doesn't decay)? The brief permits it
   only if explicitly configured; P3 builds none.
4. Should a PAUSED agent really read as RESTRICTED, or should a pause during
   maintenance be neutral?
5. Should state changes (e.g. into HIGH_RISK) emit a webhook or alert? P3
   only writes an audit event.
6. Should trust changes be visible to roles that can't view security alerts?
