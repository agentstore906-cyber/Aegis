# Aegis Agent Control Plane — Architecture and Evaluation

This document evaluates what Aegis is today (P0–P7), states precisely what it can and cannot control, and records the control-plane work built on top of it. It is written to be true: every claim of control below names the mechanism that provides it, and anything Aegis cannot intercept is said to be advisory.

Status legend: **Built** (P0–P7) · **Now** (this phase) · **Designed** (documented, not built) · **Deferred** (deliberately not built, with the reason).

---

## 1. The control loop and where each stage lives

```
IDENTITY → PERMISSIONS → OBSERVE → UNDERSTAND → TRUST → RISK → POLICY → APPROVAL → ENFORCEMENT → AUDIT
```

| Stage | Question it answers | Mechanism (code) | Status |
|---|---|---|---|
| **Identity** | Who is this agent? | `Agent` (name, slug, owner, team, environment, model/framework, status); API keys, optionally **bound** to one agent (`ApiKey.agentId`, P0 §7); `AgentConnection` for connector-registered agents | Built; **binding strength and per-agent identity summary: Now** |
| **Permissions** | What may it do? | `AgentPermission` (action pattern × resource → ALLOW / ALERT / REQUIRE_APPROVAL / BLOCK); org/agent `Policy` with conditions | Built; **telemetry fields usable in policy (destination, service, data class, sensitivity, volume): Now**; **least-privilege review (broad and unused grants): Now** |
| **Observe** | What is it doing? | `POST /api/v1/events`; `ActivityEvent` with P1 telemetry (tool, service, destination, data classes, sensitivity, volume, outcome, lineage) | Built |
| **Understand** | What is normal / unusual? | P2 baselines and `BehavioralDeviation`; P6 action graph | Built |
| **Trust** | Has this agent earned latitude? | P3 `AgentTrustState` / transitions (informational, never blocks on its own) | Built |
| **Risk** | How risky is this action, and why? | P4 signals → ordinal level + explanation, stored on every evaluation | Built |
| **Policy** | What rule applies? | `evaluateAgentAction()` — strict matching, deterministic precedence (§3) | Built |
| **Approval** | Does a human need to decide? | `ApprovalRequest`, single-use, fingerprint-bound, expiring (P0) | Built |
| **Enforcement** | What did Aegis actually do? | Decision returned to the caller; kill switch; P5 risk control (OBSERVE / APPROVAL_REQUIRED / ENFORCE); **SDK `guard()`: Now** | Built / **Now** — see §4 for what this does and does not mean |
| **Audit** | What happened afterwards? | append-only `AuditEvent`, `PolicyEvaluation` (every decision with its full control record), P7 incidents | Built; hash-chaining **Deferred** (§9) |

The loop is already closed in one place — `evaluateAgentAction()` — and every stage writes its evidence into the same append-only decision record. What was missing was not another stage; it was (a) a way to *ask* the loop a question without executing it, (b) the ability to express data/destination constraints in the policy stage, (c) one organization-wide place that shows each agent's identity, access, behavior, trust, risk, approvals, incidents and enforcement coverage, and (d) an enforcement point developers can adopt in one line.

## 2. Evaluation of the current state

### 2.1 Agent identity — mostly present; two gaps

| Required | Where it lives today | Verdict |
|---|---|---|
| identity | `Agent.id`, `slug` (unique per org), `name` | ✔ |
| owner | `Agent.owner` (free text, required), `teamId` (optional structured) | ✔ (free text is not a verified principal) |
| organization | `Agent.organizationId`, enforced on every query | ✔ |
| environment | `Agent.environment` — **server-side, authoritative**; an agent's claimed environment is ignored for matching (P0) | ✔ |
| capabilities | `AgentTool` (tools seen), `AgentConnection.capabilities` (what a connector can do) | partial — *observed* tools are not *granted* tools |
| permissions | `AgentPermission` | ✔ |
| lifecycle state | `Agent.status` (ACTIVE, PAUSED, STOPPED, NEEDS_ATTENTION, ARCHIVED) | ✔ stored; see §5 |
| trust state | `AgentTrustState` | ✔ |
| history | activity, baselines, deviations, trust transitions, evaluations, approvals, incidents, audit | ✔ — but **scattered across seven tables with no single per-agent view** |

**Gaps.** (1) *Identity strength is invisible.* An API key can be bound to one agent or be organization-wide; an organization-wide key can act as **any** agent in the organization. Aegis stores this, but nothing tells an operator which agents are protected only by an organization-wide key — i.e. which identities can be impersonated by any holder of a shared key. (2) *No per-agent control view* that gathers the above (Now).

### 2.2 Permissions — expressive enough, except for data and destinations

| Question | Can Aegis express it? | How |
|---|---|---|
| What actions? | ✔ | `AgentPermission.action` (exact or `prefix.*`) |
| On which resources? | ✔ | `AgentPermission.resource`, policy `resource` |
| Which tools? | ✔ | policy `tool` field and `tool` condition (`NOT_IN` gives an allow-list) |
| Which environments? | ✔ | the agent's environment is fixed; policy `environment` field/condition |
| Which actions need approval? | ✔ | `REQUIRE_APPROVAL` on a permission or policy |
| **Which destinations / services?** | ✘ **not before this phase** | P1 records `destination` and `service`, but policy conditions could only read `action/resource/environment/tool/riskLevel/agentId` and `context.*` |
| **Which data classes / sensitivity / volumes?** | ✘ **not before this phase** | recorded (P1), unusable in policy (the type comment says "not yet available to policy conditions") |

This is the single real expressiveness gap, and it is exactly "what data can the agent access". **Now:** policy conditions may reference `destination`, `service`, `dataSensitivity`, `recordCount`, `byteCount`, and `data.<CLASS>` (a boolean per data class). No new language, operators or tables — five more whitelisted field names resolved by the same fail-closed resolver. Two honesty rules go with it, stated in `docs/policy-engine.md`:

1. **Unreported is not "none".** A condition on a field the request did not report is *indeterminate*, and under STRICT matching (P0) an indeterminate condition **matches restrictive policies** (BLOCK / REQUIRE_APPROVAL / ALERT) and does not match ALLOW. So "BLOCK when `destination` NOT_IN [allowed hosts]" blocks a request that omits its destination — an agent cannot slip past an allow-list by staying silent.
2. **These fields are agent-reported.** Unlike `environment` and `riskLevel` (server-side, trusted), a destination or data class is whatever the integration says. A policy on them is exactly as strong as the integration's honesty, until an enforcement point that *observes* the destination (a gateway, §4 tier 3) exists. The architecture says so rather than implying otherwise.

Least privilege is supported by a **review** rather than a new permission language: for each agent, the control view lists *broad grants* (a `*` ALLOW) and *unused grants* (ALLOW permissions whose pattern matched no action the agent actually performed in the last 30 days), derived from stored data.

### 2.3 Policy — already unified; precedence made explicit

Policies, risk, trust, behavior, approvals and enforcement are already one pipeline in `evaluateAgentAction()`, with a single stored record per decision. Trust and behavior are **inputs to risk**, not separate decision-makers; risk is **advisory unless an organization opts in** (P5), and can only add caution. §3 states the one precedence order and the simulation endpoint returns it stage by stage.

### 2.4 Runtime enforcement — what is true

See §4. In short: Aegis is a **decision service plus an audit trail**. It is not in the data path. The honest enforcement tiers, and what each does and does not prove, are documented there, and a new **enforcement-coverage** measure shows, per agent and from stored evidence, how much of what an agent reports actually passed through a decision.

### 2.5 Lifecycle

Stored states already cover the operator-controlled lifecycle (ACTIVE, PAUSED, STOPPED, NEEDS_ATTENTION, ARCHIVED) with audited transitions. The proposed DISCOVERED / MONITORED / RESTRICTED states are **not** operator states — they are *derived* conditions (never configured, observed-but-unprotected, trust-restricted). Storing them would create a second source of truth that can disagree with the data. §5 maps the proposal onto the existing model: stored lifecycle stays; **a derived posture and adoption stage are computed from evidence**, never stored.

### 2.6 Inventory, simulation, APIs, DX, enterprise, platform

Covered in §5–§10. Headlines: inventory and simulation were missing and are built; the API gets exactly two justified endpoints; the SDK gets a one-call enforcement wrapper; SSO, delegated administration, hash-chained audit and a gateway are consciously deferred.

---

## 3. Policy precedence (the one authoritative order)

For one authorization request, strongest first. This is what `evaluateAgentAction()` implements, what P5 tests lock down, and what simulation reports stage by stage:

1. **Kill switch.** A PAUSED / STOPPED / ARCHIVED agent is `BLOCK`, source `CONTROL`. Nothing below can undo it — not a policy, not an approval, not risk.
2. **Explicit policy / default-deny `BLOCK`.** Final. Risk cannot weaken it; an approval id cannot be used around it.
3. **A consumed human approval** for this exact request (same agent, fingerprint, unexpired, unused) lifts a *risk* gate (and a policy `REQUIRE_APPROVAL`) once. It never lifts 1 or 2.
4. **Risk control** (P5, organization opt-in; default OBSERVE = no effect): the decision becomes `strictest(policy, risk)`. Risk can only add caution.
5. **Permissions and policies** decide everything else: the strictest matching rule wins; no rule means default-deny.

Behavior (P2) and trust (P3) never decide directly: they feed the risk assessment (4) and the audit record. This is deliberate — a statistical deviation should raise a question, not silently revoke access, unless an organization has chosen risk enforcement.

---

## 4. Runtime enforcement architecture — what Aegis can and cannot control

**Aegis does not sit between the agent and its tools.** Today `POST /api/v1/evaluate` returns a decision; the integration decides whether to obey it. Aegis controls an action *only to the extent that the code that performs the action asks Aegis first and honors the answer*. The architecture therefore distinguishes tiers, and every user-facing statement must correspond to one:

| Tier | Mechanism | Aegis can prove | Aegis cannot prove |
|---|---|---|---|
| **0 — Observe** | agent reports events | what the agent *said* it did | that the report is complete or true |
| **1 — Cooperative decision API** | agent calls `/evaluate`, obeys the result | every decision made, with its reasons | that the agent obeyed; that every action was submitted |
| **2 — In-process enforcement (SDK `guard()`) — *Now*** | the SDK wraps the tool call: authorize → run only on ALLOW/ALERT → report the outcome under the decision id; **fails closed** when Aegis is unreachable (configurable) | that code routed through `guard()` did not execute without an allowing decision, and the execution is linked to its decision | calls that bypass `guard()` (any direct call to the tool) |
| **3 — Gateway / egress proxy** | Aegis (or a customer-run component) sits on the network path to tools/APIs and checks each call | the destination and data actually observed on the wire | *Designed, not built.* Needs deployment topology Aegis does not have today |
| **4 — Credential brokering** | the agent never holds tool credentials; Aegis releases a short-lived credential only on an allowing decision | that an action could not have happened without a decision | *Designed, not built.* The only tier that is enforcement without trusting the agent process |

**Evidence of whether enforcement is real, per agent (Now): enforcement coverage.** From stored events, over a window: of the *reported executions* (events from the API, not decision records) how many carried an `evaluationId` (a decision), how many ran under a `BLOCK`/`REQUIRE_APPROVAL` decision anyway, and how many agents never request decisions at all (observe-only). Coverage near 100% with zero "ran despite decision" is evidence — not proof — that the integration honors Aegis; a low number says Aegis is currently advisory for that agent. The control view shows it; Aegis never reports an agent as "protected" because a policy exists.

The right long-term direction for "Aegis between agent and tools" is tier 2 broadly adopted, then tier 4 for high-value systems, with a gateway (tier 3) only where the customer controls the network path. Each tier is additive and none requires changing the decision engine.

---

## 5. Lifecycle, posture and adoption

**Stored lifecycle (operator-controlled, audited)** — unchanged: `ACTIVE`, `PAUSED`, `STOPPED`, `NEEDS_ATTENTION`, `ARCHIVED`. Mapping to the proposed model:

| Proposed | Reality |
|---|---|
| ACTIVE | `ACTIVE` |
| STOPPED | `STOPPED` (and `PAUSED`, its temporary form) |
| RETIRED | `ARCHIVED` |
| RESTRICTED | not a lifecycle state: it is the **derived** condition "trust is RESTRICTED/HIGH_RISK" (advisory — trust blocks nothing) or a *policy* that restricts the agent |
| DISCOVERED | **derived**: the agent exists but nothing has been granted (no permissions), so Aegis default-denies everything |
| MONITORED | **derived**: the agent reports activity but never asks for a decision (observe-only) |

**Derived posture (computed, never stored):** `RETIRED` · `STOPPED` · `PAUSED` · `NEEDS_ATTENTION` (operator states win) · then, for an ACTIVE agent: `DISCOVERED` (nothing granted) · `PROTECTED` (asks for decisions) · `OBSERVED` (reports activity, never asks) · `QUIET` (configured, no activity this week). Plus `attention` flags: high risk, trust degraded, unusual behavior, open incident, needs approval, broad grant, shared-key identity, ran despite a decision, no owner. Each flag is raised by specific stored rows and by nothing else (`lib/control/posture.ts`, unit-tested).

**Adoption stage (computed):** `CONNECTED` (exists, no recent activity) → `OBSERVING` (activity, no decisions) → `PROTECTED` (decisions requested) — with the baseline maturity and enforcement coverage shown alongside. This is the CONNECT → OBSERVE → UNDERSTAND → PROTECT → ENFORCE journey measured from data; ENFORCE is shown as coverage, not as a label, because it cannot be claimed without the evidence in §4.

**Auditability.** Update, pause, resume, stop, connect, reconnect and disconnect were audited. **Two gaps found and closed (Now):** (1) an agent entering the organization through `POST /api/v1/agents/register` — the "discovered" moment — was **not audited at all** (`agent.created` was a defined event type that nothing recorded); it now writes `agent.created` in the same transaction as the insert, naming the key (`keyId`, never the secret); (2) the kill switch's *resume from STOPPED* had no separation of duties and its status write was not a compare-and-set (§9, finding S2).

---

## 6. Organization-wide inventory — the control view

`/control` answers, from stored data, with every number a count of real rows:

- How many agents exist, by lifecycle, environment, derived posture
- Who owns them (owner, team) — and which have no owner recorded
- What can they access — permission counts by decision, broad grants, agents with nothing granted
- Which are high risk — configured risk level, trust HIGH_RISK/RESTRICTED
- Which behave unusually — behavioral deviations in the last 7 days
- Which are stopped/paused
- Which need approval — pending approval requests
- Which have incidents — open/investigating incidents
- Which are only protected by an organization-wide key; which are observe-only; enforcement coverage

Per agent there is a **Control** tab with the same facts in full, plus lifecycle history (from the audit trail), least-privilege review, and the answers to the success-criteria questions. Aggregates are computed with a fixed number of grouped queries per page (no per-agent queries), bounded by a page size and a window.

## 7. Policy simulation

"What would Aegis do if this happened?" — read-only, no side effects.

- **Before:** the policy tester called the real engine, so every test *wrote* an evaluation, an activity event, possibly an approval request, an alert and audit rows — which also feed the agent's **trust and risk history** — and any organization member could run it (finding S1).
- **Now:** `simulateAgentAction()` runs the same stages (kill switch → permission → policy → behavior/trust/risk → risk-control gate → approval requirement) from read-only inputs and returns a stage-by-stage explanation plus what Aegis *would return*. It performs **no writes at all** (tested: row counts of every evidence table are unchanged) and **never consumes or creates an approval**. A parity test runs a matrix of scenarios through both `simulateAgentAction` and the real `evaluateAgentAction` and requires identical decisions and decision sources, so the simulator cannot silently drift from the engine. The policy tester defaults to simulation; recording a real evaluation requires `manage_policies` and is labelled as counting toward the agent's history.
- **API:** `POST /api/v1/simulate` for CI / policy-as-code testing. Because its output explains detection logic, it is **opt-in** (`policy:simulate` scope, not a default scope) and **refused for agent-bound keys**.

## 8. APIs

| API | Status | Decision |
|---|---|---|
| Events, Evaluate, Approvals (read), Register | Built | the agent-facing core |
| Trust, Behavior, Action graph (read) | Built | per-agent, `*:read` scopes, new keys |
| **Simulate** | **Now** | justified: CI policy tests; the dashboard needs it anyway |
| **Inventory (`GET /api/v1/agents`)** | **Now** | justified: CMDB/SIEM/governance reporting needs the org-wide view; opt-in `agents:read`, refused for bound keys |
| Risk API, Policy CRUD API, Enforcement API, Audit API | **Deferred** | no requirement yet: risk is returned inside the audit record and explanation; policies are managed in the product; "enforcement API" would be a claim of control Aegis does not have (§4); audit export is a compliance feature (§9) |

Versioned under `/api/v1`, authenticated by hashed API key, organization from the key never the caller, scope-checked, rate-limited, request-logged (`withApiAuth`). New scopes are opt-in and granted at key creation; they cannot be combined with an agent binding.

## 9. Security review of the control plane

Method: enumerated every API route and server action for authentication, scope/capability and tenant scoping; read the paths that decide, approve, enforce and record; then wrote tests for what was fixed.

| Threat | Control | Finding |
|---|---|---|
| **Tenant isolation** | `organizationId` from the key/session, in every query; P6/P7 added "same-tenant" defense-in-depth for joined rows; tests across tenants | ✔ No cross-tenant path found. All 4 unwrapped routes are intentionally public or session-gated (auth, health, billing) |
| **Privilege escalation** | capability map, enforced in actions and services; keys cannot mint higher scopes | **S2** — any `manage_agents` role (including ENGINEER) could resume an agent an operator had **STOPPED**, undoing the kill switch's stronger state. **Fixed:** resuming STOPPED requires `resolve_security` (OWNER/ADMIN/SECURITY), enforced inside the service (not just the UI); PAUSED stays with `manage_agents`. The status write is now a compare-and-set on the status that was checked, so two operators racing can never overwrite each other (tested) |
| **Agent impersonation** | agent identity is a claim; a key bound to an agent can act only as it (P0) | **S3 (by design, now visible):** an *organization-wide* key can act as any agent. The inventory flags agents whose only identity protection is an org-wide key. Bound keys remain the control. Not changed: removing org-wide keys would break registration flows |
| **Policy bypass** | strict matching; unknown fields fail closed; environment/risk server-side; indeterminate ⇒ restrictive match; approvals fingerprint-bound | New telemetry fields are *agent-reported* (stated, §2.2); omission cannot bypass restrictive policies (tested) |
| **Approval replay** | single-use, atomic, expiring, fingerprint-bound to agent + exact request (P0); concurrent consumers tested (P5) | ✔ |
| **API abuse** | per-key rate limit (Postgres), body-size limits, idempotency, bounded pagination | New endpoints inherit all; simulate is also scope-gated + refused for bound keys because it explains detection logic |
| **Secrets** | keys stored as hashes; provider credentials AES-GCM with a versioned keyring; value-based redaction of context/alert evidence | ✔ no secret reaches responses or the graph/incident views |
| **Audit integrity** | append-only DB triggers on evaluations, activity, audit, approvals, alert occurrences, incident activity; incident anchors immutable | **S4 (limitation):** append-only is enforced by triggers, not cryptography — a database superuser could still alter history undetected. Hash-chaining the audit trail is **Deferred** (§12) |
| **Lifecycle auditability** | every status change audited with actor, reason and whether a connector enforced it | **S5** — agent *registration* through the API created agents with no audit record. **Fixed:** `agent.created` is written in the creating transaction (tested, including 5 concurrent registrations → exactly one record) |
| **Unauthorized enforcement** | risk-control mode: `manage_risk_control`, audited, confirmation required; kill switch: `manage_agents`; approvals: `resolve_approvals` | **S1** — the policy tester ran the *real* engine for any member, writing evaluations/approvals/alerts that feed trust/risk history (trust poisoning by a VIEWER). **Fixed:** testing is read-only simulation; recording requires `manage_policies` |

## 10. Developer experience

Adoption path and what a developer sees at each step:

| Step | What they do | What Aegis shows |
|---|---|---|
| **Connect** | create a key, `new Aegis(...)`, `track()` | agent appears (adoption: CONNECTED → OBSERVING) |
| **Observe** | send events | activity, graph |
| **Understand** | nothing more | baseline matures; deviations, trust |
| **Protect** | wrap tool calls with **`aegis.guard(...)`** (one call: authorize → run or refuse → report) | decisions, approvals; adoption PROTECTED; coverage appears |
| **Enforce** | add permissions/policies; optionally enable risk control | decisions change; coverage and "ran despite decision" show whether it holds |

`guard()` is the smallest honest enforcement primitive: fail-closed by default, never runs the tool without an allowing decision, links the execution to the decision, and can wait for human approval and retry exactly once with the approval. It does not pretend to stop code that does not use it.

## 11. Enterprise control — what fits now

| Capability | State |
|---|---|
| RBAC | Built (six roles, capability map, enforced in services); **kill-switch separation of duties: Now** |
| Audit | Built, append-only; compliance export and hash-chaining **Deferred** |
| Environments | Built (server-side authoritative) |
| Organization-level policies | Built (policies with `agentId` null) |
| Approval workflows | Built (single-use, expiring); multi-step/delegated approval **Deferred** (no requirement yet) |
| Compliance evidence | The decision record, incident reconstruction and evidence digests are the evidence base; packaged exports **Deferred** |
| SSO | Placeholder only (`ssoEnabled`); **Deferred** — a real integration is a product commitment, not a scaffold |
| Delegated administration | **Deferred** — the six-role model covers current stage; per-team scoping would touch every query |

## 12. Platform architecture and scaling

Already sound for the current stage: every table is tenant-keyed with `(organizationId, …)` indexes; the hot path (`/evaluate`) is bounded (a fixed number of indexed reads, risk context capped at 1.5 s, deferrable work off the response); behavioral and trust work run after the response and on a daily cron; history is append-only and bounded on read (windows, caps, keyset pagination in the graph and incident views).

Scaling considerations, in the order they will bite:
1. **Event volume** — `activity_events` is the large table. Reads are indexed and capped, but there is no partitioning or rollup retention beyond the hourly rollups (P2). Next: time-partition `activity_events`, move run summaries to a pre-aggregated table (noted in P6).
2. **Decision latency** — the risk context load is parallel and capped; baseline refresh is off-path. Next: cache the agent's baseline/trust snapshot in memory with short TTL.
3. **Background work** — `defer()` runs in-process after the response and a daily cron; at higher volume this should move to a queue.
4. **Inventory** — bounded per page with grouped aggregates; at very large agent counts add materialized per-agent summaries.

None of this is built now: the architecture does not require it yet, and over-engineering it would be a guess.

## 13. Product moat — what compounds, honestly

Value accumulates in data an organization cannot get elsewhere because it is *about their agents*: behavioral baselines (28-day, versioned), trust history (every transition with its factors), the decision record (every request, policy, risk explanation and outcome), approval history (who approved what, how fast), incident history (reconstructions with operator judgements, including false-positive labels), and the lineage graph of what agents did. Each makes the next decision better explained (risk uses baselines and trust; incidents use all of it) and lets an operator answer "is this normal for *this* agent?" in seconds.

That is genuine switching cost — leaving means losing history — and it is not artificial lock-in: every record is readable through the product and the API, none is encrypted against export, and nothing about the decision engine depends on proprietary formats. The honest gap: **there is no full-fidelity export** (audit/evidence bundles); a customer *can* leave but not yet take their history in one step. Closing that is the next trust-building step, not a retention tactic.

## 14. What was built in this phase

| # | Component | Why this one |
|---|---|---|
| 1 | Telemetry fields in policy conditions | the only real least-privilege gap (data, destinations, services, volume) |
| 2 | `simulateAgentAction` + dashboard tester + `POST /api/v1/simulate` | removes a trust-poisoning path; unlocks safe policy testing and CI |
| 3 | Control inventory, per-agent control view, derived posture/adoption, enforcement coverage, least-privilege review, `GET /api/v1/agents` | one organization-wide, evidence-backed view; makes "advisory vs enforced" visible |
| 4 | SDK `guard()` | the smallest real enforcement point; one-call adoption |
| 5 | Kill-switch separation of duties; policy-tester write gating | the two privilege findings (S1, S2) |
| 6 | Opt-in admin scopes at key creation | lets simulate/inventory be used without weakening defaults |

Not built, on purpose: gateway/credential brokering, SSO, delegated administration, hash-chained audit export, additional API families, new lifecycle states. See §4, §11, §12.

---

## 15. Outcome of this phase

**Verified:** full suite 90 files / 1,143 tests (run twice), SDK package 53 tests, `tsc`, ESLint on every new file, `next build`, and schema/migrations in sync — **no schema change and no migration** were needed (everything new is derived from existing rows, plus code).

**Tests that matter most, and what breaks them** (each was confirmed by a mutation that made it fail, then reverted):

| Property | Test | Mutation that fails it |
|---|---|---|
| Simulation writes nothing | row counts of 11 evidence tables unchanged across 14 scenarios | making the simulator write an audit row |
| Simulation = real engine | decision, source, reason, policy decision, matched policies and stored risk level identical across the matrix (permission, default-deny, policy BLOCK/ALERT, kill switch, destination allow-list ×3, data policy, risk OBSERVE / ENFORCE / APPROVAL_REQUIRED / kill-switched-ENFORCE, platform-wide disable) | changing the simulator's decision source for risk gating |
| Policy tester cannot poison history | every role × mode through the real server action | re-opening record mode to all roles |
| Kill switch separation of duties | engineer can pause/resume-paused/stop but not undo a stop; security/admin/owner can; concurrent transitions → one winner | disabling the check |
| Inventory is tenant-scoped | another tenant's agents/summary/keys/lifecycle never appear; foreign evaluation ids not counted | dropping the organization filter |
| `guard()` fails closed | a rejected request never proceeds even with `onUnavailable: "open"`; outages refuse by default | treating every error as an outage |
| Telemetry policy fail-closed | omitting destination/data/volume cannot escape a restrictive policy; silence never grants via ALLOW | (unit tests over the matcher) |

**Not built, deliberately** (with the reason in the sections above): a gateway or credential broker (tiers 3–4 need deployment topology Aegis does not have), SSO, delegated administration, hash-chained/exportable audit, additional API families (risk/policy/enforcement/audit APIs), stored lifecycle states beyond the existing ones, materialized inventory summaries, event partitioning, a queue for background work.

**Limitations that remain true:**
- Aegis is still a decision service and audit trail, not in the data path. Enforcement is real only for code routed through `guard()` (or an integration that honors `/evaluate`), and the new coverage measure is how to see how much that is.
- Policies on destination, service, data classes and volume are only as honest as the integration reporting them.
- The audit trail is append-only by database trigger, not by cryptography.
- Organization-wide API keys can still act as any agent; the control view now shows which agents are exposed that way, but removing the capability would break registration flows.
- The inventory examines up to 2,000 agents per call and computes aggregates on read; beyond that, a materialized summary is needed.
- Unused-grant review judges only the last 30 days of *actions*, not resources, and cannot tell seasonal work from dead grants.
- There is no full-fidelity export of an organization's history yet.

**Recommended next direction.** Make enforcement real where it matters most, using the coverage measure as the targeting signal: **credential brokering (tier 4) for a small set of high-value tools** — the agent never holds the credential; Aegis releases a short-lived one only on an allowing decision. It is the only step that turns "Aegis advises" into "the action could not have happened without a decision", it needs no network-path control, and coverage tells you which agents and tools to start with. In parallel, close the trust gap with an **exportable, hash-chained evidence bundle** (decision record + incident reconstruction + digests), so customers can take their history with them and verify it was not altered.
