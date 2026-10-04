# Aegis P7 — Incident Intelligence

Raw security events become an understandable reconstruction that answers one question from actual telemetry: **what happened?** An incident's first screen answers four: **What happened? Why? What did Aegis do? What evidence supports it?**

> **An incident is a handle; the story is reconstructed.** The `incidents` table stores only *which record opened it* (the anchor), *which run it belongs to* (the trace), and *how an operator has handled it* (status, acknowledgement). The timeline, the summary and the evidence list are rebuilt on every view from the underlying append-only records. An incident therefore cannot hold a fact the telemetry doesn't, and handling an incident cannot touch the records it describes.

Code: `lib/incidents/` (`reconstruct.ts` pure · `evidence.ts` tenant-scoped reads · `service.ts` · `status.ts` · `authorization.ts` · `actions.ts`) · UI `/incidents`, `/incidents/:id`, "Investigate as incident" on alerts and decisions · Migration `20261008120000_p7_incident_intelligence` · Tests `lib/incidents/__tests__/*`, `lib/__tests__/p7-incident-intelligence.integration.test.ts`.

## How incidents open

| Way | When | Identity |
|---|---|---|
| **Automatically** | a security alert is **created** (`upsertAlertFinding`; failure-isolated, so an incident problem can never break alert creation) | anchored on that alert |
| **Manually** | an operator presses **Investigate as incident** on a security alert or a policy decision (`resolve_security`) | anchored on that record |

**One incident per run.** The cluster key is the run's trace id (`trace:<id>`), or the trigger record itself when it has no trace. A further alert on the same run joins the existing incident instead of opening another; it raises the incident's severity if it is worse, and **reopens** the incident if it had been closed (a new alert is new evidence; the reopen is recorded as an automatic status change). A *repeat* of an existing alert (an occurrence) neither creates nor reopens anything. Opening is serialized per organization under an advisory lock, so concurrent triggers produce one incident and numbers (`INC-12`) are gapless.

There is **no backfill**: incidents exist from deployment onward. To investigate older activity, open one from its alert or decision.

## The timeline — every item is stored evidence

`reconstructIncident()` is a pure function of an *evidence bundle*: rows read from the stored records, nothing else. Every item is generated from exactly one stored row (or a snapshot kept inside one, such as a matched-policy entry), and carries references to it.

| Item | Built from |
|---|---|
| **Trigger** (flag on the item for the anchor record) | the alert / decision / event that opened the incident |
| **Alert** | `SecurityAlert` and each append-only `SecurityAlertOccurrence` ("raised", then "recurred") |
| **Action** | a reported `ActivityEvent` — with tool, service/API, destination, data classes and sensitivity, volume, task |
| **Decision** | `PolicyEvaluation` — decision, who decided (policy / default-deny / kill switch / approval / risk control), what policy alone said |
| **Policy** | each matched-policy snapshot, the agent's permission, or the default-deny fact, stored on the evaluation |
| **Risk** | the stored risk assessment: level, signal codes, what the risk engine recommended, risk-control outcome, the agent's trust at the time |
| **Unusual** | a `BehavioralDeviation` (P2), timed at its event |
| **Aegis** (enforcement) | what Aegis returned: `BLOCK`, `REQUIRE_APPROVAL` (and the approval opened), `ALERT`, or an allow under a consumed approval |
| **Approval** | request, expiry/cancellation, each human `ApprovalDecision` (who, what, when, comment), and consumption |
| **Trust** | `AgentTrustTransition` rows in the incident's time window |
| **Operator** | `agent.paused / stopped / resumed` audit events in the window |
| **Outcome** | what the **agent reported** for an execution — and, as an observed fact, when that was reported although the decision was `BLOCK`/`REQUIRE_APPROVAL` |

Agent, task/execution, tools, APIs and data access appear on the items that carry them (and in the summary); the execution identifier is the decision id the execution was reported under.

Order is time, then a fixed kind order (decision → policy → risk → unusual → enforcement → …), then id, so identical instants sort the same way every time. A reconstruction does not depend on the order the database returned rows (the bundle is canonicalized first — a determinism bug caught by the tests).

### What Aegis claims, and what it does not

Wording follows `docs/enforcement.md`: Aegis **returned** `BLOCK`; it never says an action was *prevented*. What happened next is only what the agent **reported**, and the summary says Aegis "cannot stop an integration that does not honor" a decision. Absence is never turned into a claim: when something is missing the summary says it is **not recorded** (below), it does not guess.

## The summary — deterministic, facts only

Each sentence is a template filled **only** with values read from the bundle, and carries references to the rows it rests on (so each sentence can be inspected). The same evidence always yields byte-identical text. Sections:

- **What happened** — the trigger; what the agent did in the run (counts of authorization requests and reported actions, tools, destinations); the data classes and highest reported sensitivity; the largest single volume.
- **Why** — the detector's finding (for an alert trigger); behavioral deviations from the baseline, described from their stored values; policies that matched and what they resolved to; "no policy covered this action" when the decision was default-deny; the kill switch when it decided; the highest assessed risk and its signals; whether the risk engine recommended something stricter; trust changes (or trust at decision time).
- **What did Aegis do** — decision tallies; each `BLOCK` and its decider; risk-control escalations; approval tallies; operator control actions; alerts raised; what the agent reported executing, and any execution reported despite a decision.
- **Not recorded / not shown** — stated as plainly as the facts:
  - the trigger carries no trace id, so only the triggering record is available;
  - the trigger record could not be retrieved;
  - actions were reported but **no authorization request is recorded** (Aegis had no opportunity to decide);
  - decisions with **no risk assessment** (made before the risk engine existed, or it was unavailable);
  - events whose parent is not part of the evidence;
  - a cap hid evidence (events, decisions, alerts, deviations).

The one-paragraph version (`summary.paragraph`) joins the most important sentence of each section, e.g.:

> Support Bot requested "crm.export" and Aegis decided BLOCK. Data involved: PII (highest reported sensitivity high). Behavioral deviation from the agent's baseline: new destination "files.unknown.example" (not in the agent's baseline, high confidence). Policy "No unknown exports" matched and resolved to BLOCK (1 decision). Aegis returned BLOCK for "crm.export" (decided by a policy or permission). 1 execution was reported as completed although the decision was BLOCK or REQUIRE_APPROVAL. Aegis returns decisions; it cannot stop an integration that does not honor them.

It says "sensitive data" only because a stored data class says so, never "customer" data unless that is what was recorded.

## Evidence

- Every timeline item and summary sentence links to **evidence records**; the Evidence section lists every stored record behind the incident, each expandable to its underlying facts (alert evidence, deviation observed values, decision reason and signals, …) with a link to the original page. Reasoning-shaped fields in stored JSON are withheld (same guard as the action graph).
- **Integrity, in code and by the database.**
  - Tests assert that every reference in every item, claim and record resolves to an existing row **in the same organization**, that every item has ≥ 1 reference, and that the record set equals the bundle's rows — nothing extra.
  - The **evidence digest** (sha256 over the sorted evidence identities) changes only when evidence is *added*. It is stored with each status change and acknowledgement, so an incident closed earlier shows *"N new pieces of evidence have been recorded since this incident's status was last changed."* Handling an incident leaves the digest unchanged (tested).
  - The security records themselves are append-only by database trigger (P0/P1). `incident_activity` is append-only (trigger). An incident's **anchor, run, number and origin are immutable** (trigger `aegis_incident_anchor_immutable`) — only handling state can move. There is no code path that deletes or rewrites evidence or history.

## Status and acknowledgement

```
OPEN ─► INVESTIGATING ─► RESOLVED
  │            │   └────► FALSE_POSITIVE
  ├──────────────────────► RESOLVED / FALSE_POSITIVE
INVESTIGATING ─► OPEN                    RESOLVED / FALSE_POSITIVE ─► OPEN (reopen; the only way out)
```

- Closed states cannot jump to each other — reopening first makes a second judgement a visible step.
- **FALSE_POSITIVE requires a note** saying why. No-op moves and over-long notes (2,000 characters) are refused.
- A change is a **compare-and-set** on the status the operator saw: if two operators act at once, exactly one wins and the other gets a clear conflict (tested). Each change writes an append-only `IncidentActivity` row (who, when, from→to, note, the evidence digest and count at that moment) **and** an audit event.
- **Acknowledgement** ("a human has seen this") is separate from status, idempotent (the first acknowledgement wins; concurrent ones record exactly one), and never changes status, evidence, or the original security alert (tested: the alert row is byte-identical). Notes are append-only too.
- Status of an incident is **independent of the alert's status**: resolving or marking an incident false-positive does not resolve the alert. (A false-positive label is operator-supplied ground truth about detection; it is not used to change any detector.)

## Search

`/incidents` filters, all scoped to the caller's organization: **status, severity, agent, opened-from/to, acknowledged, policy** (a decision in the incident's run matched it), **decision** (the run contains it), **destination** (exact host), **tool** (exact key). Policy/decision/destination/tool match anything recorded in the incident's run (or its trigger when it has no run), using `EXISTS` over the run's records filtered by the same organization and agent. Newest first, paged (25, max 100), with totals. "Organization" is the tenant: the search can only ever see the active organization's incidents.

## Security

- **Tenant isolation at every query.** Incident lookups, evidence reads (events, decisions, alerts + occurrences, approvals, deviations, trust, audit), opening from a record, search, counts and every handling action filter on the actor's `organizationId` (taken from the authenticated session, never from input). Another tenant's incident id is "not found" for viewing **and** every handling action, and the incident is verified untouched. Tests cover colliding trace ids across tenants, a foreign row that names our agent and trace, foreign alert/event ids when opening, and evidence filters that try to reach across tenants; removing the organization filter from the incident lookup, or from the evidence reads, makes tests fail.
- **Authorization.** *View* (list, detail, search, counts): `view_security` — every role except FINANCE, like alerts, behavior, trust, the action graph and risk control. *Handle* (acknowledge, change status, add notes, open an incident): `resolve_security` — OWNER, ADMIN, SECURITY. ENGINEER and VIEWER can read but not change; FINANCE sees nothing. Enforced **inside the service functions**, not only in the UI, and tested for every role and every operation (refused calls change nothing).
- **Privacy.** Destinations are host-only, end users are never shown, alert evidence and decision context are already redacted at write time and are additionally sanitized for reasoning-shaped fields here.
- **Bounded.** Evidence reads are capped (200 events, 200 decisions, 50 alerts, 100 deviations, 300 occurrences, 30 trust transitions, 30 control events); hitting a cap is reported in the summary. The timeline is capped at 600 items (the trigger is always kept); evidence records are never truncated by the display cap. The action graph has the full run.

## Tests

`lib/incidents/__tests__/` (pure, 32): the full story (all item kinds in causal order, exactly one trigger, no duplicate decision-event action, "returned" not "prevented", the paragraph and each section verbatim), determinism and input-order independence, **evidence integrity** (every item/claim reference resolves; record set equals the bundle; digest changes only on added evidence; claims carry evidence; absence never becomes a claim; per-claim evidence bounded with true totals; reasoning withheld), approvals/enforcement/operator control, **incomplete telemetry** (no trace, missing trigger, actions with no decision, decisions without risk assessments, missing parent events, caps, deviation whose event is outside the evidence, empty bundle), **concurrent events** (identical instants order deterministically; the trigger survives the cap), and the status machine (every from→to pair, closed-state rule, note rules).

`p7-incident-intelligence.integration.test.ts` (32, real database and real `/events`, `/evaluate`, alerts, approvals): reconstruction from genuinely ingested telemetry — including the real after-the-fact detector alert that opened the incident on its own · timeline kinds, policy/approval/outcome items · summary text · **every reference resolves to a stored row in the tenant** · handling leaves alerts, decisions and the digest byte-identical · evidence-added-since-status detection · search by policy/decision/destination/tool/agent/severity/status/time · automatic opening: one per run, severity raise, reopen on a new alert (history preserved), repeats ignored, alert with no trace · manual open (idempotent), lone event, deleted trigger · **concurrency**: 8 simultaneous alerts → one incident; 6 simultaneous opens → one; gapless numbering; two operators racing a status change → exactly one wins; 4 simultaneous acknowledgements → one · status machine and audit trail · notes · **database-enforced immutability** (history updates and anchor rewrites are rejected; handling state may move) · tenant isolation (all handling actions, opening, reconstruction, search, counts) · authorization for every role and operation · pagination.

## Limitations

- **Not a detector.** Incidents are opened from security alerts the existing detectors raise (or by an operator); P7 adds no new detection. A BLOCK decision or a risk-gated request does **not** open an incident by itself — it would flood the queue — but any of them can be opened with one click and will have its run reconstructed.
- **Run = trace.** Related activity is linked only through the trace id (and the trigger itself); events without one are not connected, and Aegis does not infer causality from timing. An alert with no trace yields a one-record incident, and says so.
- **Facts the platform stores, nothing more.** If telemetry was never reported (no destination, no data classes, no decision), the reconstruction cannot show it, and says what is missing where it can tell. It cannot see what an agent did that it never reported.
- **Severity is the highest in the evidence** (alerts, event risk, assessed risk), with the stored value on the incident only ever raised; the detail page shows the live value.
- **The summary is templated, not narrative.** It is deliberately terse and literal; it will not speculate about intent or impact.
- **Evidence caps** mean an extraordinarily large run is shown from its earliest records (with a stated gap); the action graph covers the whole run.
- **Closed means "as of then".** Evidence recorded after closure is flagged but does not reopen an incident by itself — only a *new alert* does.
- **Trust and control events are time-window matches** for the agent (from the first evidence to five minutes after the last), not run-specific links.
- **No public API** for incidents yet; no email/webhook notification on incident open (security alert webhooks still fire as before); no assignment/ownership beyond acknowledgement; no free-text search.

## Decisions for the product owner

1. **Open an incident for every `BLOCK` or risk-gated decision?** Currently only alerts do.
2. **Should resolving an incident be able to resolve its alerts** (currently independent, by design, so the security record is never altered).
3. **A public `incidents:read` API and an incident webhook** for SIEM/SOAR integration.
4. **Assignment and SLAs** (owner, due times) beyond acknowledgement.
5. **Using FALSE_POSITIVE labels** to tune detectors or feed the P5 review analytics (labels exist now; nothing consumes them).
