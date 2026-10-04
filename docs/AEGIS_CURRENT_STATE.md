# Aegis — Current State (verified 2026-10-01, updated after P0)

> **P0 update (2026-10-01).** The decision- and security-correctness fixes
> in `docs/AEGIS_P0_IMPLEMENTATION.md` are implemented and verified locally
> (not yet deployed). Rows and sections below that changed are marked
> **[P0]**. Everything else is as originally audited at commit `3f95863`.
> Current verification: tsc clean; 359 unit tests + 235 integration tests
> (594 total) pass against a local disposable database; `next build`
> succeeds; SDK 0.5.0 36/36.
>
> **P1 update (2026-10-02).** Agent data foundation implemented and verified
> locally (not deployed) — `docs/AEGIS_P1_DATA_FOUNDATION.md`. §4/§8.8 gaps
> addressed: events now carry destination (host only), service, end user
> (pseudonym), data classes + sensitivity, volume, outcome, server-side
> environment, `occurredAt`, a working parent/child model (FK + late linking,
> cycle-safe), decision→execution links (`evaluationId`), `clientEventId`
> dedup, recorded risk signals, normalized tool keys, value-based secret
> redaction, and database-enforced append-only evidence. 675 tests pass
> (413 unit + 262 integration); build succeeds; SDK 0.6.0 37/37.
>
> **P2 update (2026-10-03).** Behavioral memory implemented and verified
> locally (not deployed) — `docs/AEGIS_P2_BEHAVIORAL_MEMORY.md`. The thin
> seven-day baseline (`lib/security/baseline.ts`, §2 row "Behavioral
> baseline") is replaced by hourly rollups + versioned, immutable per-agent
> baselines (28-day window, NEW_AGENT / LIMITED_HISTORY / ESTABLISHED),
> explainable deviations (new tool/destination/service/action type/end user,
> unusual data type/sequence/volume/frequency/time), read APIs
> (`behavior:read`), a Behavior tab, and an optional daily cron. 717 tests
> pass (438 unit + 279 integration); build succeeds.

This is a product and technical map of the Aegis repository as it exists at
commit `3f95863`. Every claim here was checked against source code, not UI
copy or older docs. Where something exists only as a schema field, a UI
label, or a comment, this document says so.

**How it was verified:** read `prisma/schema.prisma` in full, every
`app/api/v1/*` route, `lib/api/*`, `lib/policies/*`, `lib/security/*`,
`lib/approvals/*`, `lib/enforcement/*`, `lib/agents/{control,register,queries}.ts`,
`lib/activity/ingest.ts`, `lib/webhooks/dispatch.ts`, `lib/rbac/capabilities.ts`,
`lib/auth/*`, `proxy.ts`, the SDK (`packages/agent-sdk/src`), and the existing
`docs/`. Ran `vitest` on all non-integration tests (**32 files, 302 tests,
all passing**) and `tsc --noEmit` (**clean**). The 22 `*.integration.test.ts`
files were **not** run: they use the `DATABASE_URL` in `.env`, which points
at a remote Neon database (see §9.3).

Status legend used throughout:

| Label | Meaning |
|---|---|
| **Production-ready** | Real logic, tested, no known correctness gap in the main path |
| **Implemented** | Real logic, works, has gaps or fragility called out |
| **Partial** | Some of the feature is real; important parts are missing |
| **Schema-only / placeholder** | A field, enum, or UI exists with no logic behind it |
| **Mock** | Static or fabricated data, by design |
| **Broken / unsafe** | Behaves differently from what an operator would reasonably expect |

---

## 1. Architecture

```
            ┌──────────────────────── Next.js 16 (App Router) on Vercel ────────────────────────┐
 Agent ──►  │  /api/v1/agents/register  /api/v1/evaluate  /api/v1/events  /api/v1/approvals/:id │
 (SDK or    │        │                       │                 │                  │              │
  raw HTTP) │   withApiAuth (lib/api/handler.ts): API-key auth → scope → rate limit → log       │
            │        │                       │                 │                  │              │
            │   registerAgent        evaluateAgentAction   ingestActivityEvent  getApprovalStatus│
            │                         (lib/policies)        (lib/activity)                       │
            │                              │                       │                            │
            │                              └──► runSecurityDetectors (lib/security/evaluate.ts) │
            │                                       13 detectors, inline, ~25 queries/event     │
            │                              ──► upsertAlertFinding ──► AuditEvent               │
            │                              ──► dispatchWebhookEvent (inline, up to 3 tries)     │
            │                                                                                   │
 Human ──►  │  (dashboard) Server Components + Server Actions, gated by                         │
 (browser)  │  requireActiveOrganization() + hasCapability(role, …)                             │
            └───────────────────────────────────────┬───────────────────────────────────────────┘
                                                    │ Prisma 7 + @prisma/adapter-pg
                                              PostgreSQL (Neon)
```

- **Stack:** Next.js 16.3, React 19.2, Prisma 7.9 (pg adapter), NextAuth v5
  beta (credentials only, JWT sessions), Zod 4, Tailwind 4, Vitest 4, Paddle
  billing. Workspace package `packages/agent-sdk` (TypeScript SDK).
- **Execution model:** everything is synchronous inside a request. There is
  **no queue, no worker, no cron, no scheduler** anywhere in the repo.
  Detectors, alert creation, audit writes, and webhook delivery all run
  inline in the request that triggered them.
- **Tenancy:** `Organization` is the boundary; every tenant-owned row has
  `organizationId`, and every query found was scoped by it.
- **No CI:** there is no `.github/` directory. Tests and type-checks are run
  by hand.

---

## 2. Feature inventory

| Area | Status | Evidence / notes |
|---|---|---|
| **Policy engine** (permissions + conditional policies → ALLOW / REQUIRE_APPROVAL / BLOCK / ALERT) | **Production-ready core, with a scope fail-open (see §8.2)** | `lib/policies/{evaluate,resolver,matcher,conditions}.ts`. Fail-closed default (no match = BLOCK), strictest-wins, whitelisted condition fields, prototype-pollution guards, immutable snapshots in `PolicyEvaluation`. Well unit-tested. |
| **Pre-flight authorization API** `POST /api/v1/evaluate` | **Implemented [P0]** | Kill switch honored (BLOCK/`CONTROL`); trusted server-side context; key→agent authorization; claim-first idempotency; `reason`/`decisionSource`/`agentStatus` on every response; single-use approval consumption via `approvalRequestId`. |
| **Event ingestion** `POST /api/v1/events` | **Implemented** | Rule-based per-event risk (`scoreEventRisk`), secret redaction, post-hoc policy-violation detection. `traceId` optional, never generated; `parentEventId` never accepted. |
| **Agent auto-registration** `POST /api/v1/agents/register` | **Implemented [P0]** | Upsert by slug. Plan agent limit enforced under a per-org lock (also in the Connect flow). Agent-bound keys can't create agents. Remaining: an org-wide key holder still chooses the new agent's `environment`/`riskLevel`. |
| **Approvals** (human-in-the-loop) | **Implemented [P0]** | Race-safe resolve/cancel; immutable `ApprovalDecision`. 24h pending deadline with lazy expiry (read/list/resolve/use). An `APPROVED` request is single-use and bound to the exact request through a fingerprint, with a 1h execution window and atomic consumption. Pre-P0 approvals can't be consumed. |
| **Approval polling** (SDK `waitForApproval`) | **Implemented** | Capped exponential backoff; no push channel back to the agent. |
| **Audit trail** | **Production-ready** | Append-only `AuditEvent`; system/user/agent actors; CSV export (plan-gated). |
| **Security detectors** (13) | **Implemented** | `lib/security/detectors.ts`: new sensitive action, new tool, block spike, failure loop, high-risk burst, cost spike, volume spike, data-access spike, delete spike, communication spike, policy violation after the fact, prompt-injection keyword indicator (LOW confidence), credential-shaped field. Pure functions, unit-tested, honest wording. Run **after** the decision; they never influence the decision they're attached to. |
| **Security alerts** (dedupe, ack, resolve) | **Implemented [P0]** | Every trigger is stored as an append-only `SecurityAlertOccurrence`. Severity never downgrades. A `dedupeKey` separates distinct findings. Find-or-create runs under an advisory lock. The detail page shows the occurrence history. |
| **Behavioral baseline** | **Partial** | `lib/security/baseline.ts`: 7-day per-day rates (events, tool/model calls, data access, deletes, comms, failures, blocks, cost), with a minimum-data guard. Computed on read and never stored. No per-tool, per-destination, per-resource, per-user, sequence, or time-of-day profile. |
| **Agent Risk Score** (0–100 with reasons) | **Implemented** | `lib/security/risk-score.ts`: transparent additive factors. Shown in the UI; **not used by any decision**. |
| **Per-event risk scoring** | **Implemented [P0]** | `lib/security/risk-scoring.ts`: keyword rules. Now also the risk *floor* on `/evaluate`: max(claim, agent level, score). A lower claim is kept as evidence. |
| **Kill switch** (pause / stop / resume) | **Implemented — cooperative [P0]** | `/evaluate` returns BLOCK (`decisionSource: CONTROL`) for PAUSED, STOPPED, and ARCHIVED agents. A halted agent reporting a completed action raises `ACTIVITY_WHILE_HALTED`. External process halting is still unavailable (`enforced: false`, stated in the UI). |
| **Enforcement connectors** | **Placeholder (honest)** | `lib/enforcement/*`: interface plus a null implementation only. |
| **Agent connections** (OpenAI / Anthropic / custom SDK) | **Implemented [P0]** | Verifies provider keys and discovers OpenAI assistants. Credentials use AES-256-GCM with a **versioned keyring** (`CONNECTOR_ENCRYPTION_KEYS`, `AUTH_SECRET_PREVIOUS`, lazy and bulk re-encryption), so rotating `AUTH_SECRET` no longer bricks credentials. Still pulls no telemetry from providers. |
| **Cost intelligence** | **Implemented** | Self-reported cost plus token-based *estimates* clearly labeled. Price table in `lib/costs/pricing.ts` is a hardcoded, already-stale snapshot. Budgets alert only and never stop spending (documented honestly). |
| **Webhooks** (outbound) | **Implemented [P0]** | HMAC-signed, SSRF-checked, delivery log. Delivered **after the response** via `after()`, so they are off the decision path. Still best-effort (no durable outbox or scheduler). |
| **RBAC** | **Production-ready** | 6 roles × 14 capabilities in one map (`lib/rbac/capabilities.ts`). Every member, including VIEWER, can view approvals and evaluations. No separation-of-duties rule (an OWNER can author a policy and approve its exceptions). |
| **Authentication** | **Implemented** | Credentials + bcrypt, JWT sessions (30 days). No OAuth, MFA, or SSO (`ssoEnabled` is schema-only). Route protection uses `proxy.ts` plus `requireActiveOrganization()` in the dashboard layout. |
| **API keys** | **Production-ready [P0]** | SHA-256 hashed, scoped, expiring, revocable. **Agent binding**: a bound key can only act as its agent (events, evaluate, approvals) and can't register agents. SDK keys from the Connect flow are bound automatically. There is still no scope picker. |
| **Rate limiting** | **Implemented [P0]** | Postgres-backed shared fixed window in production (`RATE_LIMIT_BACKEND`), used by the API, sign-in, sign-up, and leads limiters. Fails open. No direct automated test of the Postgres path yet. |
| **Idempotency** | **Implemented [P0]** | Claim-first (concurrent same-key → one execution, others get 409 `IN_PROGRESS`). The claim is released on failure; expired and abandoned claims are reclaimed per key. The SDK sends a per-call key reused across retries. No global cleanup job. |
| **Activity feed / detail** | **Implemented** | Filters, live refresh. Trace shown as a raw ID; **no trace or tree view**. Approval and alert detail pages do pull related events by `traceId`, which is the start of an incident view. |
| **Policy tester / evaluations log** | **Implemented** | Dashboard tester calls the real engine (and persists real evaluations). |
| **Ask Aegis** | **Implemented (deterministic)** | Regex intent router over real queries. No LLM. Honest "not enough evidence" fallback. |
| **"AI Agent Risk Scanner"** | **Implemented (Oct 2026, local, not deployed)** | Free, anonymous-first self-assessment at `/scan` with a deterministic, explainable risk engine, private report, public share page, claim-after-signup into `/risk-scan`. See `docs/AEGIS_FREE_RISK_SCANNER.md`. It scores a *described* configuration; it does not inspect a live agent (that is Phase 4 of its roadmap). |
| **Retention** | **Schema-only** | `*RetentionDays` columns and a settings form; nothing deletes data. |
| **SSO** | **Schema-only** | `ssoEnabled` / `ssoProvider`. |
| **Teams** | **Minimal** | A label used for cost grouping; no membership. |
| **Billing (Paddle)** | **Implemented** | See `docs/` and memory notes; out of scope for this review. |
| **Plan entitlements** | **Partial [P0]** | Agent limit is now enforced on every creation path, race-safe. `canUseAdvancedPolicies` is still never called outside tests. |
| **`/demo`** | **Mock (by design)** | `components/demo/data.ts` is static fabricated data used for the public demo. Must never leak into the real dashboard. |
| **Marketing pages** | Mostly honest | `/trust` explicitly states there are no certifications. The home page says "enforce it before actions run", which is only true when the integration calls `/evaluate` and obeys the response (cooperative enforcement). |

---

## 3. Primary user flows (as implemented)

1. **Onboard:** sign up → create organization (Personal/Team/Enterprise
   label) → onboarding checklist.
2. **Connect an agent:** either the Connect wizard (verify an
   OpenAI/Anthropic key, or provision a custom-SDK API key) or the SDK calls
   `registerAgent()`.
3. **Define control:** add `AgentPermission` rows (per-action baseline) and
   org/agent `Policy` rows with conditions. Test in the policy tester.
4. **Runtime:** the agent calls `authorize()` → `/evaluate` → decision.
   On `REQUIRE_APPROVAL` the agent polls `waitForApproval()` while a human
   resolves the request in `/approvals`.
5. **Observe:** the agent calls `track*()` → `/events` → activity feed,
   risk level, detectors, alerts, cost.
6. **Respond:** an operator reviews `/security` alerts (ack/resolve), pauses
   or stops the agent (recorded only), and exports audit/security CSVs.

---

## 4. Data model (what matters for the control loop)

```
Organization ─┬─ Agent ─┬─ AgentTool (declared tools, manual)
              │         ├─ AgentConnection (1:1, provider link)
              │         ├─ AgentPermission (action[+resource] → decision)
              │         ├─ ActivityEvent ──(1:1 optional)── PolicyEvaluation ──(1:1)── ApprovalRequest ── ApprovalDecision*
              │         ├─ SecurityAlert (type string, dedupe, evidence Json, traceId)
              │         └─ Budget
              ├─ Policy ── PolicyCondition*
              ├─ AuditEvent (append-only)
              ├─ ApiKey ── IdempotencyRecord
              └─ WebhookEndpoint ── WebhookDelivery
```

**ActivityEvent** is the telemetry backbone. Its structured columns are
`eventType, action, resource, description, toolName, source, status,
riskLevel, durationMs, modelProvider, modelName, costCents, inputTokens,
outputTokens, taskId, taskType, traceId, parentEventId, errorMessage,
metadata(Json)`. It has **no** columns for destination (host, domain, or
recipient), end-user or on-behalf-of principal, data classification, record
or byte volume, or sequence position. `parentEventId` exists but nothing
writes it.

Correlation between objects is by `traceId` string only: there is no foreign
key from `SecurityAlert` to `ActivityEvent`, and window-based detectors
(spikes) carry no `traceId` at all.

Events created by `/evaluate` do **not** carry `toolName`; the tool is
stored only on `PolicyEvaluation.tool`. Tool history is therefore split
across two tables depending on the entry path.

---

## 5. Agent lifecycle (actual)

```
created (dashboard / connect wizard / SDK register)
   │  status=ACTIVE, riskLevel = whatever was chosen (static)
   ▼
reporting (events / evaluations)  ── lastActiveAt is NOT updated by ingestion (grep: no writer in lib/activity or lib/policies)
   │
   ├─ operator → PAUSED / STOPPED / ACTIVE  (recorded + audited + webhook; not enforced)
   ├─ NEEDS_ATTENTION  — selectable/filterable, but **nothing sets it automatically**
   └─ ARCHIVED         — blocks control actions in the UI; the API still accepts events/evaluations
```

There is no automatic state change driven by behavior, alerts, or risk. An
agent's `riskLevel` never changes unless a human edits it.

---

## 6. Security model

**Strong:**
- Tenant isolation by `organizationId` on every query reviewed.
- API keys hashed, scoped, revocable, and expiring; per-route scope checks.
- Secret redaction before persistence (`redactSecrets`) and secret-shaped
  key detection.
- Condition evaluation never runs code; field whitelist; proto-pollution
  guards; request body size caps (8–32 KB).
- Webhook SSRF re-validation on every attempt; HMAC signatures.
- Provider credentials encrypted at rest (AES-256-GCM).
- Approval resolution is race-safe; audit is append-only; `ApprovalDecision.decidedBy`
  uses `Restrict`.
- An explicit honesty boundary (`EnforcementOutcome`) that keeps the UI from
  claiming "blocked" when Aegis only recorded something.

**Weak or missing:** see §8.

---

## 7. Integrations

| Integration | Direction | Real? |
|---|---|---|
| TypeScript SDK (`@aegis/agent-sdk`) | agent → Aegis | Yes: track, authorize, waitForApproval, registerAgent; retries on 429/5xx/network |
| Raw HTTP API v1 | agent → Aegis | Yes (4 endpoints) |
| OpenAI connector | Aegis → provider | Key verification and assistant discovery only |
| Anthropic connector | Aegis → provider | Key verification only |
| Outbound webhooks | Aegis → customer | Yes, best-effort |
| Paddle | billing | Yes |
| Python SDK, LangChain/LangGraph/CrewAI/MCP adapters, OpenTelemetry ingest, gateway/proxy | — | **None exist** |

---

## 8. Limitations and correctness gaps (highest impact first)

> **[P0]** §8.1, §8.2, §8.4, §8.5, §8.6, §8.7, the agent-authorization
> gap, the register plan-limit bypass, the in-memory rate limiter, the
> `AUTH_SECRET` coupling, and the integration-test database risk (§9.3) are
> fixed. See `docs/AEGIS_P0_IMPLEMENTATION.md` for each fix, its tests, and
> its remaining limits. §8.3 (risk/behavior don't drive decisions) and §8.8
> (thin telemetry) are V2 work and remain open. The original findings are
> kept below as the audit record.

### 8.1 The kill switch doesn't affect decisions — **Broken (expectation mismatch)** — *fixed in P0*
`setAgentControlState` writes `Agent.status = STOPPED`, but neither
`evaluateAgentAction` nor the `/evaluate` route reads `Agent.status`. A
stopped agent that calls `authorize()` still gets `ALLOW`. This is the
cheapest form of real (cooperative) enforcement Aegis could provide, and
it's missing. The UI copy is honest about external enforcement, but an
operator will reasonably assume Aegis's *own* answers change.

### 8.2 Policy scope fails open on omitted fields — **Unsafe** — *fixed in P0*
`policyScopeMatches` requires `policy.environment === input.environment`
(and the same for `tool`, `riskLevel`, `resource`). If the caller **omits**
`environment`, a policy like *"BLOCK `payments.*` in PRODUCTION"* doesn't
match. `Agent.environment` is never used as a default, and `riskLevel` is
whatever the caller asserts. An agent, buggy or adversarial, can avoid
scoped BLOCK/REQUIRE_APPROVAL policies by leaving out a field or
under-declaring its risk. (Without a matching permission, the action still
falls to default-BLOCK, but with a broad permission such as `payments.* →
ALLOW` the scoped deny is skipped.)

### 8.3 Risk and behavior never change a decision — **Architectural gap**
Decision = static permissions + policies. Per-event risk scoring runs only
on `/events`. Detectors run **after** the decision is persisted. The risk
score is display-only. Behavioral signals can't make Aegis say "approve
first" or "block", which is the central promise of a control plane.

### 8.4 Approvals never expire and aren't bound to execution — *fixed in P0*
No caller sets `expiresAt`. An `APPROVED` status isn't tied to a single use,
a time window, or the parameters that were approved. Nothing records whether
the approved action was actually executed afterwards.

### 8.5 Alert dedupe loses information — *fixed in P0*
See the security-alerts row in §2. The practical effect: severity can go
down, earlier evidence is overwritten, and the first trace is the only one
kept.

### 8.6 Hot-path latency and coupling — *largely fixed in P0 (side effects deferred)*
One `/evaluate` call does: ~3 reads, a 2–4 write transaction, ~25 count or
aggregate queries for detectors, up to ~6 sequential alert upserts (each
with its own audit write), budget checks, and **synchronous webhook delivery
with retries** (up to ~16.5 s against a slow endpoint). This is all before
the agent gets its answer. A pre-flight control point needs a tight, bounded
latency budget.

### 8.7 Error after commit → duplicate decision — *fixed in P0*
On `ALERT`, `upsertAlertFinding` runs **after** the transaction commits and
isn't wrapped. If it throws, the route returns 502, the SDK retries on 5xx,
and, unless the caller supplied an Idempotency-Key (the SDK doesn't
generate one), a second evaluation is created. With `REQUIRE_APPROVAL` the
same retry path can create a duplicate approval.

### 8.8 Thin telemetry for behavioral intelligence
No destination, principal, data-class, or volume fields. No `parentEventId`
writes. `traceId` is optional on `/events`. See `AEGIS_V2_ROADMAP.md`
(Behavioral Baseline) for what this blocks.

### 8.9 Operational
- In-memory rate limiter on serverless.
- No background jobs, so retention, idempotency cleanup, webhook retries,
  and baseline rollups can't happen.
- No CI.
- Connector-credential encryption key is derived from `AUTH_SECRET`.
  Rotating the session secret silently makes every stored provider
  credential undecryptable. `AUTH_SECRET` is validated only as `min(1)`.
- Hardcoded model price table (stale model names).
- `lastActiveAt` isn't maintained by ingestion.

---

## 9. Technical debt and risks

1. **Synchronous side effects everywhere.** This is the root cause of §8.6,
   §8.7, and the missing retention and cleanup jobs.
2. **Two risk vocabularies.** Per-event `RiskLevel` (keyword rules) and the
   agent 0–100 score (alert-count factors) don't share inputs or a
   pipeline, and neither feeds the decision.
3. **[Fixed in P0]** **Integration tests point at whatever `.env` says.** Today that's a remote
   Neon database. If it's the production database, `npm test` writes and
   deletes test rows there (22 integration files, 108 `deleteMany` calls).
   This needs a dedicated `DATABASE_URL_TEST` with a guard.
4. **String-typed correlation** (`traceId`) instead of relations for
   alert→event and approval→execution.
5. **Detectors hardcode thresholds.** No per-org or per-agent tuning and no
   feedback loop from "resolved as expected".
6. **Unused or dormant surface:** `parentEventId`, `NEEDS_ATTENTION`
   automation, `canUseAdvancedPolicies`, `AgentTool` (manually declared
   tools, never reconciled with observed `toolName`).

---

## 10. Existing strengths (what to build on, not replace)

1. **A correct, explainable, fail-closed decision core** with immutable
   evaluation snapshots. This is the right foundation for a unified engine.
2. **A culture of honesty encoded in types** (`EnforcementOutcome`,
   confidence on alerts, "not enough baseline data" states). This is rare
   and is a trust differentiator with security buyers.
3. **Per-agent baselines and 13 pure, tested detectors.** Explainable by
   construction; easy to promote from "after the fact" to "decision input".
4. **A transactional decision → approval → audit chain** with idempotency.
5. **A clean service/action split and pure functions**, so new pipeline
   stages can be unit-tested without a database.
6. **Single-tenant-boundary discipline** and a single RBAC capability map.
7. **An SDK that already models the safe-execution pattern** (authorize →
   wait → act).
