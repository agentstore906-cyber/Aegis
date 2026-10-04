# Aegis P6 — Agent Action Graph

A security engineer should be able to answer **"what exactly did this agent do?"** without searching through hundreds of log lines. P6 turns the telemetry Aegis already holds into a run-by-run picture of an agent's activity: what it was asked, which tools and APIs it used, what data it touched, what was decided, what was approved or blocked, and what it reported happened.

> **It is a read model.** The graph is derived on demand from existing rows. P6 adds **no table and no column** — the only schema change is that new API keys get the `graph:read` scope by default. Nothing is copied, so there is no second copy of the event store to keep in sync or to leak.

Code: `lib/graph/` (`build.ts` pure builder · `queries.ts` tenant-scoped, bounded reads · `sanitize.ts` · `chain.ts` · `authorization.ts`) · API `app/api/v1/agents/[slug]/graph/runs[/[traceId]]` · UI: agent page → **Action graph** tab (`components/graph/*`) · Migration `20261007120000_p6_action_graph` · Tests `lib/graph/__tests__/*`, `lib/__tests__/p6-action-graph.integration.test.ts`.

## What it shows

```
USER ─ACTED_THROUGH→ AGENT ─RAN→ TASK ─STARTED→ ACTION ─CAUSED→ ACTION …
                                                  │ USED_TOOL → TOOL
                                                  │ CALLED    → API
                                                  │ ACCESSED  → DATA
                                                  └ RESULTED_IN → RESULT
```

| Node | Where it comes from | If it was not reported |
|---|---|---|
| **USER** | `endUserHash` — the keyed pseudonym of the end user the agent acted for (P1). The raw id is never stored and never shown; only an 8-character prefix is displayed. | No node. |
| **AGENT** | the agent | always present |
| **TASK** | `taskId` / `taskType` when the event carries them; otherwise **the run itself** (a trace id), labelled `Run <trace>`. Aegis has no separate task concept, so a trace *is* the unit of work. | the run |
| **TOOL** | `toolKey` (display name from `toolName`) | No node. |
| **API** | `destination` (host-only, P1), else `service` | No node. |
| **DATA** | each `dataClasses` entry (with sensitivity, record and byte counts in the detail) | No node. |
| **ACTION** | one per `ActivityEvent` — a decision (`source: policy_evaluation`) or a reported action/execution | — |
| **RESULT** | an observable: **"Decided ALLOW/BLOCK/…"** for an `/evaluate` event, **"Reported success/failure/blocked/warning"** for an execution, else the event status | — |

Entities are de-duplicated within a page and linked to every action that used them. **Nothing is invented**: an entity that was not reported produces no node, and an unresolvable parent produces no node or edge.

### Relationships and ordering

- **Parent/child** is P1 lineage (`parentEventId`): decision → execution (an execution reported with `evaluationId` defaults its parent to the decision's event), follow-on actions, and children named by the caller's own id (`parentClientEventId`) that are linked when the parent arrives.
- **Order** is Aegis's receipt time (`timestamp`), then id — P1's "trusted ordering". `occurredAt` (what the agent claims) is shown when it differs by more than a second, but is never used to sort. Siblings and roots are in this order, and the result does not depend on the order rows were read.
- **Execution identifiers.** A decision's id (the `evaluationId` returned by `/evaluate`) is what an execution is reported under, so decision → execution is always connected. Event ids, decision ids and trace ids are shown in each row.

### Missing parents are explained, not hidden

A row that is a root says **why** (`parent.status`):

| Status | Meaning |
|---|---|
| `root` | It names no parent. |
| `linked` | Its parent is on this page. |
| `awaiting_parent` | The agent named a parent by its own id (`parentClientEventId`) that Aegis has not received (yet). It links the moment it arrives (verified). |
| `outside_page` | Its parent exists in this run on another page of the timeline. |
| `unavailable` | Its parent is not in this run — missing, in a different trace, or not visible to this organization's agent. |
| `cycle` | Its parent chain loops. P1 makes this impossible; if a row ever violates it, it is shown rather than crashing or looping. |

### What a security engineer can see on each action

Expanding a row (native `<details>`, no client JavaScript needed) shows: the **USER → AGENT → TASK → TOOL → API → DATA → ACTION → RESULT chain for that event**; its **context** (resource, tool, service, destination and kind, data classes and sensitivity, record/byte volume, task, end-user pseudonym, duration, reported outcome); the **decision** (decision, who decided — policy / default-deny / kill switch / approval / risk control — what policies alone said, matched policies, the agent's permission, the risk level assessed, what the risk engine recommended, what risk control did, the agent's trust at the time); **approvals** (status, link, and which approval a decision consumed); **blocked actions**; **risk signals**; **behavioral deviations** (P2) with their explanations; and the sanitized reported context. A "Needs attention" list on each page jumps to blocked decisions, gated requests, pending approvals, high-risk actions, unusual behavior, and executions reported despite a decision.

**"Reported executed despite decision"** is an observed fact, worded as one: a decision of `BLOCK` or `REQUIRE_APPROVAL` exists, and the agent separately reported the action as succeeded under it. It is not an accusation, and the row says Aegis returns decisions but cannot stop an integration that does not honor them (see `docs/enforcement.md`).

## Only observable action and context metadata

Aegis does not collect an agent's reasoning, and the graph never displays any. Free-form caller `metadata`/`context` is the one place reasoning could arrive, so before any display or API response (`lib/graph/sanitize.ts`):

- fields **named** like reasoning content (`reasoning`, `thought(s)`, `thinking`, `chain_of_thought`, `scratchpad`, `monologue`, `rationale`, `reflection`, `cot` — whole-token matches, any nesting depth) are replaced with `[withheld: reasoning content]`, and the row says content was withheld;
- ordinary fields that merely contain "reason" (`failure_reason`, `reasonCode`) are kept;
- strings are truncated (500 characters; 300 for the agent's one-line description and error message), and keys, array length and depth are bounded.

**Limit:** this is a guard by field *name*, not a content classifier — reasoning sent under an innocent key cannot be recognized. The defense is upstream: do not send it. This is tested end to end (the withheld text is absent from both the page model and the API response).

## Performance: bounded by construction

Nothing loads an unlimited graph and there is no recursive query.

- **No recursion.** P1 guarantees a parent shares its child's trace, so "a run" is one indexed lookup by `traceId` — never a walk up or down the parent chain. The in-memory tree is built iteratively (a 10,000-deep chain builds without touching the call stack, tested).
- **Runs list** (`listRuns`): a window (`days`, default 7, max 30) over the agent's newest events with a hard scan cap (50,000 rows; if hit, the response says `scanTruncated` and the oldest runs may be partial), grouped in SQL, **keyset**-paginated by `(last activity, trace id)`, 20 per page (max 50).
- **One run** (`getRunGraph`): **keyset** pagination by `(timestamp, id)`, default 100 events per page, **hard max 500** (larger requests are clamped in the library and rejected with 400 by the API). Each page makes a fixed number of queries — the page of events with its decision/approval/deviations joined in (no per-row queries), one lookup for any parents not on the page, and a handful of aggregates for whole-run totals (counts by status, decisions, tools, destinations, data classes). Whole-run totals appear on every page, so a page never has to be summed.
- A garbage cursor is ignored (starts at the beginning) rather than erroring.
- Measured locally (not a benchmark): paging a 1,200-event run in six 200-event pages, including the whole-run aggregates on each, takes about 240 ms. The aggregates scan the run's events by `traceId` (and the runs list scans up to the cap above); there is no pre-computed summary yet, so a single trace with millions of events would make those aggregates slow.

## Security

- **Tenant isolation at every query.** Every read filters on `organizationId` **and** `agentId`; the agent is itself resolved inside the caller's organization first (dashboard) or via the key (API). A foreign trace id, agent, or organization yields nothing, in every combination (tested both ways, including when two tenants use the *same trace id* string).
- **Rows that should be impossible are still contained.** Foreign keys do not enforce "same organization", so an event whose `parentEventId` points into another tenant is shown as `unavailable` with nothing from the other tenant; an event whose `evaluationId` points to another tenant's evaluation has the link, the evaluation, its approval and the id string itself dropped. Both are tested with deliberately corrupted rows (the second test caught a real leak of the foreign id string during development).
- **Authorization.**
  - **Dashboard:** the Action graph tab and the link on the activity page require `view_security` (every role except FINANCE) — the same visibility as security alerts, behavior, trust and risk control, because the graph shows decisions, policies and risk.
  - **API:** `graph:read` scope on the key, included by default for keys created after P6 (existing keys are not changed — create a new key). An agent-bound key can read only its own agent (403 `AGENT_NOT_AUTHORIZED`); another organization's slug or trace id is `404` (indistinguishable from not existing); a missing scope is `403 INSUFFICIENT_SCOPE`.
- **Privacy.** End users appear only as pseudonym prefixes. Destinations are host-only (P1). Context is sanitized as above.
- **Read-only.** P6 writes nothing.

## API

`GET /api/v1/agents/:slug/graph/runs` — the agent's runs, newest first. Query: `days` (1–30, default 7), `limit` (1–50, default 20), `cursor` (pass back `nextCursor`). Returns `{ agent, windowDays, since, scanTruncated, ungroupedEvents, nextCursor, runs: [{ traceId, firstAction, taskId, events, firstAt, lastAt, blocked, approvalRequired, maxRisk, tools, destinations }] }`.

`GET /api/v1/agents/:slug/graph/runs/:traceId` — one page of a run. Query: `limit` (1–500, default 100), `cursor`. Returns `{ traceId, agent, stats, graph: { nodes, edges, timeline, attention, counts }, page: { size, returned, cursor, nextCursor } }`. `timeline` is the parent/child tree in temporal order; `nodes`/`edges` are the entity graph for tooling that wants to draw its own. `404 RUN_NOT_FOUND` if the run does not exist for that agent.

## Using it

Agent → **Action graph** tab → pick a run → expand rows. From an activity event, **"See this action in its run"** opens the run scrolled to that action. A row's **"Link to this action"** is a stable, shareable URL (`?tab=graph&trace=…#evt-…`). Events that carry **no trace id** belong to no run (the list says how many); they remain in the Activity feed. Aegis assigns a trace id to every `/evaluate` decision; for reported events, send one `traceId` per piece of work (and `parentEventId` / `parentClientEventId` to nest) to get a connected graph.

## Tests

`lib/graph/__tests__/build.test.ts` + `sanitize.test.ts` (52, pure): construction (all eight node kinds, de-duplication, no invented entities, API from service, decision vs outcome results), parent/child nesting and ordering (receipt time not `occurredAt`, id tie-break, input-order independence, a parent received after its child), every missing-parent status, loops and self-parents, a **10,000-deep chain** and a **5,000-wide fan-out**, empty page, blocked/gated/pending/risk-gated/high-risk/executed-despite flags, and reasoning withholding.

`p6-action-graph.integration.test.ts` (22, real database, real `/events` and `/evaluate` routes): construction from genuinely ingested lineage (decision → execution → follow-on with entities, decision details, pseudonymous user) · late-linked parent · receipt-order siblings · blocked decision + execution reported despite it + pending approval · missing/cross-trace parents · **a 1,200-event run paged 200 at a time (every event exactly once, parents on earlier pages flagged `outside_page`, whole-run totals on every page)** · page-size clamping · garbage cursor · runs list newest-first/paginated/windowed/summarized · tenant isolation (colliding trace ids, every agent×organization combination, poisoned parent pointer, poisoned evaluation link) · API authorization (scope, 401, bound key, cross-tenant 404, out-of-range paging 400, role matrix) · reasoning never reaches the page model or the API response. Removing the organization filter from the run query makes the isolation test fail.

## Limitations

- **A trace is the run.** Without `taskId` there is no finer notion of "task"; events without a trace id appear in no run. The graph is only as connected as the telemetry: events reported with no `parentEventId`/`parentClientEventId` are roots, and Aegis does not infer causality from timing.
- **Receipt order, not true order.** Ordering by receipt time can place a child before a late-arriving parent in the flat order; the tree still nests them correctly.
- **Paged trees.** On a large run a page shows only its own events: children whose parent is on another page start their own subtree on that page (marked `outside_page`). The "Needs attention" list covers the current page, while the counts in the header cover the whole run.
- **No pre-aggregation.** Run summaries are computed on demand within the stated bounds; very high-volume agents get a partial runs list (flagged) and very large single traces get slower totals.
- **Not a visual node-link diagram.** The UI is a nested, expandable timeline plus a chain per action; the node/edge data is in the API for tools that want to draw one.
- **Reasoning guard is name-based** (above).
- **No cross-agent graph.** A run belongs to one agent; a parent in another agent's trace shows as `unavailable`.
- **Dashboard only for humans; the API requires a new-style key.**

## Decisions for the product owner

1. **Pre-aggregated run summaries** (a table) for very high-volume agents — adds storage and a write path.
2. **A first-class "task"** (an id agents set once per piece of work) instead of treating the trace as the task.
3. **Cross-agent runs** for multi-agent systems (a parent in another agent's trace).
4. **A drawn node-link view** on top of the node/edge API.
5. **Whether FINANCE should see the graph** (currently no — it shows decisions and risk).
