# Aegis P5 — Risk-Driven Control

P4 made Aegis explain risk. P5 lets an organization decide, deliberately and reversibly, whether that risk may **influence what Aegis returns** for an authorization request.

> **Nothing changes unless an organization opts in.** Every organization — existing and new — is in **OBSERVE**: risk is assessed, compared with the real decision and stored, and never alters it. The migration changes no decision. Enabling anything requires an explicit confirmation, is audited, and can be undone in one click without deleting evidence.

Code: `lib/risk/control.ts` (pure planner) · `lib/risk/record.ts` · `lib/risk/settings.ts` · `lib/risk/analytics.ts` · `lib/risk/actions.ts` · wiring in `lib/policies/evaluate.ts` · UI `/risk-control` · Migration `20261006120000_p5_risk_control` · Tests `lib/risk/__tests__/control.test.ts`, `lib/__tests__/p5-risk-control.integration.test.ts`.

## What "enforcement" means here

Aegis is a control plane (see `docs/enforcement.md`). `POST /api/v1/evaluate` returns a decision; the calling integration decides whether to honor it. A risk-driven `BLOCK` is therefore exactly as strong as any other `BLOCK`: it is a recorded, returned decision, **not** proof the agent stopped. The wording throughout follows that rule:

- the decision record says what Aegis **returned** (`finalDecision`, `finalSource`), never that an action "was prevented";
- in OBSERVE the UI and the shadow summary say **"would have"** — never "blocked";
- the agent's own reported execution (`POST /api/v1/events` with the `evaluationId`) remains the only evidence of what actually ran (P1's `executed_despite_decision` signal covers the gap).

## Phase 1 — Shadow mode

Every evaluation records **actual vs recommended**, in the `riskAssessment.shadow` object and the queryable columns `riskRecommendedDecision` / `riskShadowOutcome`:

```
Actual:       ALLOW
Recommended:  BLOCK
Outcome:      WOULD_ESCALATE
Summary:      Actual: ALLOW. Aegis risk engine: WOULD BLOCK.
Why:          new destination · sensitive data (PII) · unusual volume (8× its 95th percentile)
```

*Recommended* is now computed from the **organization's configured mapping** (below), so an organization can set `High → BLOCK`, stay in OBSERVE, and see exactly what that setting would have done before it enables anything. It is still never weaker than the actual decision. P4's outcomes are unchanged: `AGREES`, `WOULD_ESCALATE`, `ACTUAL_STRICTER`, `SUPPRESSED` (a consumed human approval holds the recommendation at the actual decision).

## Phase 2 — Configuration

Three columns on `organizations`, edited at **Risk control** (`/risk-control`) by OWNER / ADMIN / SECURITY (`manage_risk_control`); everyone with `view_security` can see them.

| Setting | Values | Default |
|---|---|---|
| `riskControlMode` | `OBSERVE`, `APPROVAL_REQUIRED`, `ENFORCE` | `OBSERVE` |
| `riskMediumAction` (what a MEDIUM assessment maps to) | `ALLOW`, `ALERT`, `REQUIRE_APPROVAL` | `ALERT` |
| `riskHighAction` (HIGH **and** CRITICAL) | `REQUIRE_APPROVAL`, `BLOCK` | `REQUIRE_APPROVAL` |

| Mode | What risk may do to a decision |
|---|---|
| **OBSERVE** | Nothing. Assess, compare, record. |
| **APPROVAL REQUIRED** | Add `ALERT` or `REQUIRE_APPROVAL`. **Never `BLOCK`**: a configured `BLOCK` is capped to `REQUIRE_APPROVAL` (and recorded as `cappedByMode`; the shadow still shows what ENFORCE would have done). The safe stepping stone — risk can only route to a human. |
| **ENFORCE** | Apply the configured mapping, including `BLOCK`. |

Rules: blocking medium risk is not offered; high cannot be more lenient than medium; moving **from OBSERVE** to either other mode requires ticking an explicit confirmation (server-checked); every change writes an audit event (`risk_control.config_updated`) with the actor and before/after values; saving an unchanged form writes nothing.

## Phase 3 — Enforcement and precedence

LOW → ALLOW (risk has no objection); MEDIUM → `riskMediumAction`; HIGH/CRITICAL → `riskHighAction`, subject to the mode.

**Precedence, strongest first** (implemented in `lib/risk/control.ts` and `lib/policies/evaluate.ts`):

1. **Kill switch.** A paused/stopped/archived agent is `BLOCK`, `decisionSource: CONTROL` — before, and regardless of, risk. Risk is not consulted for the decision (outcome `KILL_SWITCH`), and a pending approval cannot be used around it.
2. **Explicit policy / default-deny `BLOCK`.** Authoritative and final. Risk cannot weaken it, it is not credited to risk, and an `approvalRequestId` cannot be used to get around it (BLOCK is not approvable).
3. **A consumed human approval** for this exact request (same agent, same fingerprint, unexpired, unused) lifts a *risk* gate (outcome `APPROVAL_HONORED`). It never lifts 1 or 2. It is single-use, atomic and fingerprint-bound exactly as in P0.
4. **Risk.** The decision becomes `strictest(policy, risk)`. A risk-driven change has `decisionSource: RISK`.
5. **Policy** decides everything else, exactly as before P5.

So risk **only ever adds caution**: for every mode, level, mapping and policy decision the result is never weaker than policy alone (exhaustively tested). A policy `REQUIRE_APPROVAL` stays `REQUIRE_APPROVAL` at LOW risk; an `ALERT` policy remains a `POLICY_ALERT`; a risk-driven ALERT raises its own `RISK_ALERT` so the two stay distinguishable.

**Approval path.** A risk gate creates the same `ApprovalRequest` as a policy gate, linked to the evaluation. The approval page now shows the full risk assessment (reasons, evidence, escalation, what the control did) so the human sees *why* before deciding. Re-asking with the `approvalRequestId` while pending returns the same request (no duplicate). After approval, the retry is consumed once → `ALLOW` (`decisionSource: APPROVAL`). Rejected, expired, already-used or different-request approvals leave the request gated (`BLOCK`).

**Block path.** `BLOCK` from risk creates no approval, records the activity event as `BLOCKED`, and the `RISK` decision source.

**What the agent sees.** The `/evaluate` response gains nothing new except `decisionSource: "RISK"` and a generic reason naming the level and mode, e.g. *"Approval required by Aegis risk control: this request was assessed as HIGH risk (risk control mode ENFORCE). Permissions and policies alone would have returned ALLOW: …"*. Individual signals (destinations, volumes, trust) are **not** returned — they are operator evidence, and returning detection logic to a possibly-compromised agent teaches it how to stay under the line. The full explanation is on the evaluation and approval pages.

**No feedback loop.** A risk-control gate is the system's own action, so it is excluded — like kill-switch refusals — from P3 trust evidence (blocks and violations) and from the risk engine's `historical_incident` signal. Otherwise a gated request would lower trust, raise risk, and gate the next one, indefinitely. (Rejected approvals still count: a human judged the agent's request bad.)

## Safety: what every decision records

Every evaluation row (any mode) carries — written once, append-only by DB trigger:

| Required | Where |
|---|---|
| decision | `decision` (+ `policyDecision`: what policy alone said) |
| reason | `reason` |
| policy | `matchedPolicyIds` / `matchedPolicySnapshots` / `permissionSnapshot`, `decisionSource`, `policyDecision` |
| risk signals | `riskAssessment.reasons` (full evidence) and `riskControl.signals` (compact) |
| trust state | `riskControl.trust` (`state`, `score`, `evaluatedAt`) and `riskAssessment.context.trust` |
| timestamp | `createdAt`, `riskControl.decidedAt` |
| execution identifier | the evaluation `id` (what the agent attaches as `evaluationId` when it reports the execution) and `traceId` |
| the mode in force | `riskControlMode` (effective), `riskControl.configuredMode`, `config`, `globallyDisabled` |
| what risk did | `riskControlOutcome` + `riskControl` |

`riskControlOutcome`: `OBSERVED` · `NO_CHANGE` (enforcing, risk added nothing) · `ESCALATED` (risk made it stricter) · `APPROVAL_HONORED` · `UNAVAILABLE` · `KILL_SWITCH`. Each `ESCALATED` / `APPROVAL_HONORED` decision also writes a `risk_control.enforced` audit event in the **same transaction** as the decision.

## Emergency control

- **Kill switch stays authoritative** (above).
- **Per organization:** the **Disable risk enforcement** button (or setting the mode to OBSERVE) returns to observation immediately. It is idempotent, audited (`risk_control.emergency_disable`), and deletes/rewrites nothing — past assessments and decisions are untouched (tested byte-for-byte) and shadow recording continues, so the organization keeps learning while enforcement is off.
- **Platform-wide:** `AEGIS_RISK_CONTROL_DISABLED=1` forces every organization to OBSERVE without touching any data. Each decision records both `configuredMode` and the `effectiveMode` actually applied, and the settings page says so.
- **If risk cannot be assessed** while enforcement is on (evidence lookup failed or timed out), **policy stands** — documented fail-open, because failing closed would turn a risk-engine outage into an outage of every agent. It is never silent: a `risk_control_unavailable` log line and `riskControlOutcome: UNAVAILABLE` on the row. (See the decision list.)

## Shadow analytics

`/risk-control` and `getRiskAnalytics()` (`lib/risk/analytics.ts`; default 14 days, tenant-scoped) report **counts of recorded decisions**:

- **Would have blocked / required approval / alerted** — `WOULD_ESCALATE` rows by recommended decision, using the organization's mapping.
- **What risk control did** — observed, no-change, escalated (blocked / approval / alert), approval-honored, unavailable, kill-switch.
- **Top risk reasons** — signal codes across the flagged decisions, with decision and agent counts (bounded to the newest 20,000 flagged rows).
- **False-positive review** — a queue of the flagged decisions where an operator can mark each **Justified / False positive / Unsure** (`manage` via `resolve_security`; one current label per decision, every change audited).

**What is deliberately not claimed.** Aegis has no ground truth for "should this have been stopped." Therefore:

- no false-positive *rate* is shown from anything but operator labels;
- a share is shown only after **30** justified/false-positive labels exist, with its sample size, as *the share of reviewed decisions* — reviewers choose what to review, so it is not a random sample and is not a rate over all decisions;
- "would have blocked" counts are what happened to requests that risk did not stop — they are not a prediction of accuracy, and a count of `WOULD_ESCALATE` is not a count of "mistakes" or of "attacks".

## Tests

`control.test.ts` (unit; 30 cases): defaults never change behavior, level mapping, modes, **exhaustive precedence property** (gate never weaker than policy across 3×4×3×2×4 combinations), global disable, no-assessment fail-open, outcome labels, validation, agent-facing reason leaks no signals, control record.

`p5-risk-control.integration.test.ts` (30 cases, real DB, real `evaluateAgentAction` and `POST /api/v1/evaluate`): shadow mode (Actual ALLOW / Recommended BLOCK, full record) · configuration confirm/audit/validation · LOW/MEDIUM(×3)/HIGH enforcement incl. `RISK_ALERT` · APPROVAL_REQUIRED cap · policy precedence (explicit BLOCK vs risk, approval id cannot bypass, risk never loosens, default-deny, policy REQUIRE_APPROVAL + risk BLOCK, `POLICY_ALERT` untouched) · approval path (pending re-ask no duplicate, approve → consume once, replay blocked, different request / rejected stays gated) · kill switch (also against an approval) · emergency disable (history byte-identical, audited, idempotent, shadow continues) · platform-wide switch · unavailable assessment · no trust/history feedback · Idempotency-Key replay (one evaluation, one approval, no signals in the response) · 8 concurrent identical decisions (all recorded) · 6 concurrent consumers of one approval (exactly one `ALLOW`) · config changes between decisions · analytics counts, no rate without labels / below 30 / correct at 30, relabeling replaces · tenant isolation (modes, queue, labels, analytics, config, API key). A mutation check (disabling the gate) failed 22 tests.

## Limitations

- **Cooperative enforcement** — see above. A returned `BLOCK` or `REQUIRE_APPROVAL` binds only an integration that honors it.
- **Uncalibrated.** The risk levels are P4's ordinal judgments, not fitted to outcomes. There are no labeled data yet; the review queue exists to produce them. Run in OBSERVE, review, and enable `APPROVAL_REQUIRED` before `ENFORCE`.
- **Fail-open when risk is unavailable.** An attacker who could force the evidence lookup to time out could bypass risk (never policy, never the kill switch). The load is bounded (1.5 s) and the gap is recorded and logged; there is no per-organization fail-closed option yet.
- **Agent trust and baselines are the stored ones** (P4 limitation, unchanged): up to a day stale in the worst case.
- **Risk-driven `ALERT` is advisory** — the action proceeds, as with any ALERT.
- **Approvals are not re-risked.** A valid human approval of the exact request lifts a risk gate even if the risk picture changed afterwards; it is bounded by the approval's execution expiry.
- **Only authorization decisions** are controlled; after-the-fact events (`POST /api/v1/events`) cannot be.
- **No per-agent or per-action overrides**; configuration is organization-wide. No Action Graph and no Incident Intelligence (explicitly out of scope).
- **Analytics are on-demand queries**, not pre-aggregated; fine for the intended window, bounded where unbounded (top reasons).

## Decisions for the product owner

1. **Fail-open vs fail-closed** when risk cannot be assessed (currently fail-open, recorded).
2. **Should an approval ever be re-risked** at consumption time (currently honored)?
3. **Rollout:** suggest OBSERVE → review `WOULD_ESCALATE` with labels → `APPROVAL_REQUIRED` for a pilot organization → `ENFORCE` only after labeled data supports `BLOCK`.
4. **Should `BLOCK` from risk be allowed at all** for organizations without labeled review data (it is allowed once explicitly configured and confirmed)?
5. **API exposure of assessments** to operators (read scope) — currently dashboard-only.
