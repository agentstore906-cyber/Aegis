# Aegis V2 Roadmap

Companion to `AEGIS_CURRENT_STATE.md` (verified state), `AEGIS_CONTROL_ENGINE.md`
(design), and `AEGIS_MOAT.md` (why). **Nothing here is implemented yet.**
This supersedes the feature ordering in `docs/product/roadmap.md` for the
control-plane track. That file's operational items (CI, background jobs,
Paddle sandbox) are absorbed below.

**Scoring axes:** Customer value (V), Differentiation (D), Retention (R),
Feasibility (F, higher = easier), Security (S), Integration complexity
(I, higher = easier for the customer), Moat (M). Scale 1–5.

**Ordering principle:** (1) fix anything that makes Aegis's answers wrong
or unsafe, (2) build the substrate that starts the compounding data
accumulating, (3) put that data into decisions, (4) make the value
visible.

---

## P0: fundamental, highest leverage

### P0-1. Make Aegis's own decisions correct and safe *(security fixes)*
| Item | Why | Effort |
|---|---|---|
| **Control gate:** `/evaluate` returns BLOCK for `STOPPED` / `PAUSED` / `ARCHIVED` agents, with an explanation from the audit row | Kill switch currently changes nothing Aegis says (current-state §8.1). Real cooperative enforcement with zero customer code change | S |
| **Server-authoritative envelope:** default `environment` from the agent; `riskLevel = max(caller, scored, agent)`; write `toolName` on evaluate events | Scoped BLOCK policies are bypassable by omitting fields (§8.2) | S |
| **Fail-closed scope semantics for unknown fields** on BLOCK/APPROVE policies, with a one-release org opt-out and a changelog note | Same root cause; a behavior change, so ship it explicitly | M |
| **Approval expiry default** (org setting, e.g. 24 h) **and single-use binding** (approval valid for one execution of the same action + resource + context hash) | Approvals currently live forever and can be replayed (§8.4) | M |
| **Alert dedupe fix:** never downgrade severity; keep per-occurrence evidence (bounded list or child rows); include action/policy in the dedupe key | Evidence is lost and severity regresses today (§8.5) | S |
| **Wrap the post-commit ALERT path**; have the SDK auto-generate an Idempotency-Key per `authorize()` call (reused across its own retries) | Duplicate evaluations and approvals on retry (§8.7) | S |
| **Register API respects the plan agent limit** | Entitlement bypass | S |

*V5 D2 R4 F5 S5 I5 M2.* This doesn't create a moat, but every later item
depends on the decision being trustworthy.

### P0-2. Take side effects off the request path
- Move detectors, alert upserts, budget checks, and webhook delivery into
  `after()` (Next.js 16 `next/server`, verified in
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`;
  bounded by the route's `maxDuration`).
- Set a latency budget for `/evaluate` (target p95 ≤ 150 ms), measured in
  the existing `logApiRequest`.
- Pick the job infrastructure **once** (Vercel Cron + a Postgres-backed job
  table is enough). Use it for webhook retries, idempotency-record cleanup,
  retention, and baseline recompute. That closes four documented gaps with
  one decision.
- Move the rate limiter to a shared store (Postgres or Upstash) behind the
  existing `RateLimiter` interface.

*V4 D2 R3 F4 S4 I5 M2.* A prerequisite for putting risk in the hot path.

### P0-3. Telemetry envelope v2 *(start the moat clock)*
- API and SDK accept `destination`, `principal`, `dataClass`,
  `volume{records,bytes,amountCents}`, and `parentEventId`. Always assign a
  `traceId`.
- Add `ActivityEvent` columns for the above, plus `SecurityAlert.activityEventId`
  and `ApprovalRequest.executedEventId`.
- Update the SDK convenience helpers (`trackApiCall` → `destination`,
  `trackDataRead` → `dataClass` / `volume`), keeping them backward
  compatible.
- Maintain `Agent.lastActiveAt` (it's never written today).

*V4 D4 R4 F4 S3 I4 M5.* **Data not captured now can never be backfilled.**
This is the cheapest high-moat item.

### P0-4. Persistent behavioral baseline (rollups + profile) — *implemented as "P2" (docs/AEGIS_P2_BEHAVIORAL_MEMORY.md)*
- `AgentActivityRollup` hourly upserts in `after()`.
- `AgentBaseline` versioned profile (sets, robust rate statistics, volume
  percentiles, transitions, hour-of-week mask) with LEARNING / ESTABLISHED /
  STALE maturity.
- Rewrite `lib/security/baseline.ts` to read the profile and show the
  existing Behavioral Baseline card from it (no UI regression).
- Anti-poisoning rules (§2.3 of the engine doc).

*V4 D5 R5 F3 S4 I5 M5.*

### P0-5. Unified risk pipeline, in SHADOW mode
- `RiskSignal` contract. Port existing detectors into signals where they're
  per-action (new action, new tool, block spike, credential, injection).
  Add novelty, rate, and volume signals from the baseline.
- Combiner plus a default trust×band matrix. `strictest(control, policy, risk)`.
- Extend `PolicyEvaluation` with `decisionSource, policyDecision, riskScore,
  riskBand, signals, trustState, baselineVersion, mode, shadowDecision,
  explanation`.
- **Shadow mode is the default.** `shadowDecision` is recorded and the
  policy decision is returned. Per-agent toggle to ENFORCED.
- API response gains an `explanation` object (additive, non-breaking).

*V5 D5 R5 F3 S5 I5 M4.*

### P0-6. "Aegis stopped this" card plus shadow report
- Decision explanation card on evaluation, approval, and alert detail pages,
  and an Overview "Stopped by Aegis / Would have stopped" feed.
- "What Aegis did" and "If allowed" follow the truthfulness rules
  (engine doc §7.2). Enforcement shows "Not confirmed" until P1-1.
- Shadow summary: *"Risk escalation would have held N actions this week."*

*V5 D5 R5 F4 S3 I5 M3.* This is the signature experience and makes P0-4
and P0-5 visible.

### P0-7. Engineering safety net
- CI (GitHub Actions): `tsc`, `eslint`, `prisma validate`, and unit tests on
  every push; integration tests against an ephemeral Postgres.
- **Integration tests must refuse to run unless `DATABASE_URL_TEST` is set
  and differs from `DATABASE_URL`.** Today they run against the remote Neon
  database in `.env`.
- Separate `CONNECTOR_ENCRYPTION_KEY` (with a migration path from the
  `AUTH_SECRET`-derived key), and require `AUTH_SECRET` to be at least 32
  chars.

*V3 D1 R2 F5 S5 I5 M1.* Cheap; protects production data and secrets.

---

## P1: important

| # | Item | Notes | V/D/R/F/M |
|---|---|---|---|
| P1-1 | **SDK `guard()`** plus `decision.honored` / `executed` acknowledgements | Turns "Returned BLOCK" into "✓ agent confirmed". Closes the approval → execution link. Also a Python SDK (most agents are Python) | 5/4/5/3/4 |
| P1-2 | **Dynamic trust state + `AgentTrustEvent` ledger** | Transitions from alerts, incidents, approvals, and clean periods. Selects the matrix row. Always shown with its last reasons | 4/5/5/3/5 |
| P1-3 | **Incident model + reconstructed timeline** | Auto-created from risk/control BLOCKs and CRITICAL alerts; groups alerts; gap markers; provenance labels | 5/4/5/3/4 |
| P1-4 | **Operator feedback loop:** "Mark as expected" / "Not expected" on signals and alerts | Writes the baseline allowlist and trust ledger. The most important moat input | 4/5/5/4/5 |
| P1-5 | **Action Graph** per trace and task (swimlane view) | A read model over the P0-3 fields; observable metadata only | 4/4/4/3/3 |
| P1-6 | **Approval UX upgrades:** show the explanation card in the approval; Slack/email notification; push resume via webhook to the agent's callback | Approvals are where humans feel Aegis daily | 5/3/5/3/3 |
| P1-7 | **Auto-transition `NEEDS_ATTENTION`** from trust/incident state; operator "Restrict" / "Quarantine" buttons | Uses the existing enum | 3/3/3/5/2 |
| P1-8 | **Scoped API keys picker** plus a per-agent key binding (a key can act only as its agent) | Today any key can act as any agent in the org | 3/2/2/4/1 (S5) |
| P1-9 | **Weekly "Aegis stopped" digest** (in-app, then email) | A retention artifact | 4/3/5/4/2 |
| P1-10 | **Framework adapters** (LangGraph / OpenAI Agents SDK / MCP tool wrapper) built on `guard()` | Adoption, not differentiation | 4/2/3/3/3 |

---

## P2: useful later

| # | Item | Why later |
|---|---|---|
| P2-1 | Org-tunable signal weights and matrix, with "what-if" replay over past evaluations | Needs P0-5 data to tune against |
| P2-2 | Cross-customer opt-in priors (destination reputation, profile norms) | Needs scale and a consent model (moat doc §4) |
| P2-3 | Statistical seasonality (hour-of-week rate models, month-end patterns) | Robust median/MAD covers most cases first |
| P2-4 | Real enforcement connectors (gateway / egress proxy, MCP server proxy) | Large surface; `guard()` gets most of the value cooperatively |
| P2-5 | Retention execution, SSO/SAML, audit export to SIEM | Demand-driven (existing roadmap stance) |
| P2-6 | Auto-graduated approvals ("approved 50× identically → suggest a policy") | Needs P1-2/P1-4 history |
| P2-7 | Live model price feed for cost estimates | Low differentiation |
| P2-8 | Agent Arena: add runtime-behavior categories from baselines | Marketing loop, after real baselines exist |
| P2-9 | Learned (ML) anomaly signals, clearly labeled, as **additional** signals only | Only once labeled feedback (P1-4) exists in volume |

---

## Recommended sequencing

```
Sprint 1  P0-1 (correctness/safety)  +  P0-7 (CI, test-DB guard, key separation)
Sprint 2  P0-2 (after() + job table + shared rate limit)  +  P0-3 (envelope v2 — start recording)
Sprint 3  P0-4 (rollups + baseline profile)
Sprint 4  P0-5 (risk pipeline, SHADOW) + P0-6 (explanation card, shadow report)
Sprint 5+ P1-1 guard()/acks → P1-4 feedback → P1-2 trust → P1-3 incidents → P1-5 graph
```

**Recommended first change, pending approval:** P0-1. It's small, it has no
schema dependency except approval expiry, it fixes the two issues where
Aegis currently gives a wrong answer (the stopped agent still ALLOWed;
scoped policies bypassed by omission), and it's directly testable with the
existing `resolver` / `matcher` unit tests.

## Acquisition: Free AI Agent Risk Scanner *(implemented separately)*

`docs/AEGIS_FREE_RISK_SCANNER.md`. A public, anonymous-first self-assessment that becomes the homepage's primary
CTA and feeds scans into the dashboard after sign-up. It is an entry point to the control plane, not a new
enforcement path: its recommendations map only to controls that exist and label the rest "Coming soon". Its later
phases (configuration analysis, log analysis, connected scanning, continuous monitoring) build on the P2–P7
data foundations above.

## Risks to manage

- **Behavior change in policy matching** (P0-1 fail-closed scope). Ship with
  a changelog entry, a per-org opt-out, and a shadow comparison count
  first.
- **False positives** from risk signals. Mitigated by shadow mode by
  default, maturity gating, and confidence weighting.
- **Latency regression** when adding signals. Mitigated by P0-2 first, the
  baseline read as one row, and a measured latency budget.
- **Telemetry adoption.** The new fields are optional, and value degrades
  gracefully ("destination unknown" means no destination signal, never a
  guess).
