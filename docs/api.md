# Public API (Phase 4)

This document covers `app/api/v1/*` — the endpoints a real external agent
(via `@aegis/agent-sdk` or plain HTTP) uses to authenticate, report
activity, ask for a policy decision, and poll an approval. Every endpoint
is a thin wrapper around code that already exists and is already tested
elsewhere: `evaluateAgentAction` ([`docs/policy-engine.md`](policy-engine.md))
and `getApprovalStatus` ([`docs/approvals-and-audit.md`](approvals-and-audit.md))
are called directly, unmodified.

## Authentication

Every request needs an API key, created from **Developers → API Keys** in
the dashboard:

```
Authorization: Bearer aegis_live_9f3a2b1c...
```

Keys are organization-scoped — every request acts as the organization that
created the key, never as a user, and can only ever reference agents,
evaluations, and approvals belonging to that same organization. See
[Key format & hashing](#key-format--hashing) below for how keys are
generated and verified.

## Common headers

| Header | Required | Purpose |
|---|---|---|
| `Authorization` | Yes | `Bearer <key>` |
| `Content-Type` | POST only | `application/json` |
| `Idempotency-Key` | Optional | Makes a retried mutating request safe — see [Idempotency](#idempotency) |

Every response includes `x-aegis-request-id` — include it when reporting an
issue.

## Endpoints

### `POST /api/v1/events`

Reports an action your agent already took. Does not ask permission — see
`/evaluate` for that. Scope required: `events:write`.

**Request**

```json
{
  "agent": "finance-agent",
  "eventType": "TOOL_CALL",
  "action": "invoice.read",
  "resource": "invoice",
  "description": "Read invoice inv_123 for renewal check",
  "tool": "Stripe",
  "status": "SUCCESS",
  "traceId": "trace_123",
  "durationMs": 420,
  "model": "gpt-5",
  "provider": "openai",
  "cost": 0.014,
  "metadata": { "invoiceId": "inv_123" }
}
```

`agent` is the agent's **slug** (shown in the dashboard URL,
`/agents/<slug>`), scoped to your organization. `eventType` is one of
`TOOL_CALL`, `MODEL_CALL`, `DATA_ACCESS`, `ACTION`, `DEPLOYMENT`,
`COMMUNICATION`, `FINANCIAL`, `SYSTEM`. `status` is `SUCCESS` (default),
`FAILURE`, `BLOCKED` (your own guardrail stopped the action), or `WARNING`
(succeeded, but the agent itself flagged it as suspicious) — mapped
internally to the dashboard's `ALLOWED`/`FAILED`/`BLOCKED`/`WARNING`
activity status, since this endpoint reports something that already
happened, not a policy decision. `tool` names the integration that
performed the action (e.g. `"CRM"`, `"Zendesk"`) and `description` is an
optional human-readable summary shown in the activity feed instead of the
raw `action` code. All fields except `agent`, `eventType`, and `action`
are optional. `metadata` is capped in size/depth/key-count by the same
sanitizer the policy engine's context uses (`lib/policies/safe-context.ts`),
and any key that looks like a secret (`token`, `password`, `apiKey`, …) is
redacted before it's ever stored — never rely on the caller to keep secrets
out of `metadata`.

Risk level isn't a request field — Aegis computes it from `eventType`,
`action`, `resource`, and `status` using a deterministic rule engine
(`lib/security/risk-scoring.ts`), never from a value the caller supplies.

**Response** — `201`

```json
{ "id": "evt_...", "traceId": "trace_123" }
```

#### Structured telemetry fields (P1)

All optional, on both `/events` and `/evaluate` unless noted. Normalized on
receipt; a value that can't be normalized is a `400 INVALID_REQUEST`, never
silently dropped. Full model: `docs/AEGIS_P1_DATA_FOUNDATION.md`.

| Field | Type | Stored as |
|---|---|---|
| `service` | string ≤80 | normalized key (`"HubSpot API"` → `hubspot-api`) |
| `destination` | URL, hostname, or email | host / IP / email **domain** only — never path, query, credentials, port, or the email's local part |
| `endUserId` | string ≤256 | keyed, org-scoped pseudonym only — the raw value is never stored |
| `dataClasses` | array of `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `PII`, `FINANCIAL`, `HEALTH`, `CREDENTIALS` (case-insensitive) | enum array; `dataSensitivity` derived from it |
| `dataSensitivity` | `LOW`…`CRITICAL` | can raise, never lower, the derived sensitivity |
| `recordCount` | integer 0…1e9 | as sent |
| `byteCount` | integer 0…2,147,483,647 | as sent |
| `parentEventId` | Aegis event id | must exist in your org (and, for an agent-bound key, belong to that agent) → `400 INVALID_PARENT_EVENT` |
| `parentClientEventId` | your parent's `clientEventId` | linked now, or when the parent arrives (same agent only) |
| `clientEventId` *(events only)* | `[A-Za-z0-9._:-]{1,120}` | unique per agent; re-delivery → `200` with `duplicate: true`; different content → `409 CLIENT_EVENT_ID_CONFLICT` |
| `evaluationId` *(events only)* | id from `/evaluate` | must be this agent's evaluation → `400 INVALID_EVALUATION_REFERENCE`; defaults the parent to that decision's event |
| `occurredAt` *(events only)* | ISO-8601, ≤5 min in the future, ≤30 days old | caller's time; Aegis's own receipt time is kept separately |

A child inherits its parent's `traceId`; an explicit conflicting `traceId` is
`400 PARENT_TRACE_MISMATCH`. `/events` responds
`{ id, traceId, parentEventId, duplicate }` (`201` new, `200` duplicate).

### `POST /api/v1/evaluate`

Asks whether your agent may perform an action. Scope required:
`policy:evaluate`.

**Request**

```json
{
  "agent": "finance-agent",
  "action": "refund.issue",
  "resource": "payment",
  "environment": "production",
  "context": { "amount": 1250, "currency": "USD" },
  "traceId": "trace_456"
}
```

`environment` is case-insensitive (`"production"` or `"PRODUCTION"` both
work). If the decision is `REQUIRE_APPROVAL`, Aegis has already created an
`ApprovalRequest` and recorded an audit event by the time this responds —
see [`docs/approvals-and-audit.md`](approvals-and-audit.md).

**Trusted context (P0).** `environment` and `riskLevel` are *claims*, not
facts. Policies are matched against the agent's own environment as
configured in Aegis (a different claimed value is ignored and recorded as
evidence), and against a risk level that is never lower than the agent's
configured level or Aegis's own score of the action. A field you omit can
only make a decision stricter — see `docs/policy-engine.md` "Missing and
unusable fields".

**Kill switch (P0).** If the agent is `PAUSED`, `STOPPED`, or `ARCHIVED` in
Aegis, the decision is always `BLOCK` with `decisionSource: "CONTROL"`.

**Using an approval (P0).** To act on an `APPROVED` request, call
`/evaluate` again with the *same* request plus
`"approvalRequestId": "apr_..."`. Aegis returns `ALLOW` exactly once
(`decisionSource: "APPROVAL"`); reuse or any mismatch returns `BLOCK` with an
`approvalDenialCode` (`APPROVAL_ALREADY_USED`, `APPROVAL_REQUEST_MISMATCH`,
`APPROVAL_AGENT_MISMATCH`, `APPROVAL_EXPIRED`, `APPROVAL_REJECTED`,
`APPROVAL_CANCELLED`, `APPROVAL_EXECUTION_WINDOW_EXPIRED`,
`APPROVAL_LEGACY_UNBOUND`, `APPROVAL_NOT_FOUND`). If the referenced request
is still pending, the response is `REQUIRE_APPROVAL` with the same
`approvalRequestId` (no duplicate request is created).

**Response** — `200`, shape depends on `decision`:

```json
{ "decision": "ALLOW", "evaluationId": "eval_...", "traceId": "trace_456" }
```

```json
{
  "decision": "REQUIRE_APPROVAL",
  "evaluationId": "eval_...",
  "approvalRequestId": "apr_...",
  "traceId": "trace_456"
}
```

```json
{
  "decision": "BLOCK",
  "evaluationId": "eval_...",
  "reason": "Blocked because the active policy \"Block customer export\" matched \"crm.export\".",
  "traceId": "trace_456"
}
```

`reason` is always the same human-readable string shown in the
dashboard's evaluation detail view — policy/action names and matched
condition values only, never an internal implementation detail. Since P0 it
is present on **every** decision (previously only on `BLOCK`), alongside
these additive fields:

| Field | When | Meaning |
|---|---|---|
| `decisionSource` | always | `CONTROL` (kill switch), `POLICY`, `DEFAULT_DENY` (nothing matched), `APPROVAL` (an approval was consumed or refused), or `RISK` (the organization's risk control made the decision stricter than policy alone — P5, off unless the organization enables it; see `docs/AEGIS_P5_CONTROL.md`) |
| `agentStatus` | always | The agent's control state at decision time |
| `approvalExpiresAt` | `REQUIRE_APPROVAL` | ISO deadline for a human decision (24h) |
| `consumedApprovalRequestId` | `ALLOW` via approval | The approval this execution used up |
| `approvalDenialCode` | `BLOCK` via approval | Why the referenced approval couldn't be used |

`decision` may also be `ALERT` (allowed, and a security alert was raised) —
treat it as allowed-and-flagged.

### `GET /api/v1/approvals/:id`

Polls the current state of an approval request. Scope required:
`approvals:read`. Only returns a request belonging to your organization —
a request from another organization looks identical to one that doesn't
exist (`404 APPROVAL_NOT_FOUND`).

**Response** — `200`

```json
{ "id": "apr_...", "status": "PENDING", "decision": null, "resolvedAt": null }
```

```json
{
  "id": "apr_...",
  "status": "APPROVED",
  "decision": "APPROVED",
  "resolvedAt": "2026-08-12T18:04:11.000Z",
  "expiresAt": "2026-08-13T18:00:00.000Z",
  "executionExpiresAt": "2026-08-12T19:04:11.000Z",
  "consumed": false,
  "consumedAt": null
}
```

`APPROVED` is not by itself permission to act: it opens a one-hour execution
window (`executionExpiresAt`) during which the approval can be consumed once
via `POST /api/v1/evaluate` with `approvalRequestId`. A key bound to one agent
can only read that agent's approvals; anything else returns
`404 APPROVAL_NOT_FOUND`.

`status` is `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, or `CANCELLED`.
There is no webhook — poll this (the SDK's `waitForApproval()` does this
for you with backoff) until `status !== "PENDING"`.

### `POST /api/v1/connect/handshake`

Tells Aegis "this is my agent, calling with its own key." Requires an **agent-bound** key with `events:write`; the agent is the key's agent (the body cannot name another).
Optional body: `{ "sdkVersion"?: string, "framework"?: string }`.

```json
{ "connected": true, "established": true, "agent": { "slug": "support", "name": "Support" }, "firstHandshakeAt": "...", "lastSeenAt": "..." }
```

`established` is true only on the request that first connected the agent; repeats return `false` and record nothing new. Errors: `401` (missing/invalid/revoked key),
`403 AGENT_NOT_AUTHORIZED` (organization-wide key), `409 AGENT_CONNECTION_DISCONNECTED`, `429`. See `docs/AEGIS_AGENT_CONNECTION.md`.

### `POST /api/v1/agents/register`

Optional convenience so a brand-new agent doesn't need a dashboard visit
before its first `/events` or `/evaluate` call. Scope required:
`events:write`. Upserts by a slug derived from `name` — calling it again
with the same name returns the same agent (`created: false`), it never
creates a duplicate.

**Request**

```json
{ "name": "Finance Agent", "modelProvider": "OpenAI", "modelName": "gpt-5" }
```

Only `name` is required; `owner`/`modelProvider`/`modelName` default to
placeholder strings if omitted (edit them later from the dashboard).

**Response** — `201` if created, `200` if it already existed:

```json
{ "id": "...", "slug": "finance-agent", "name": "Finance Agent", "created": true }
```

## Errors

Every error response has the same shape:

```json
{ "error": { "code": "INVALID_REQUEST", "message": "The field `action` is required." } }
```

| Code | HTTP status | Meaning |
|---|---|---|
| `MISSING_API_KEY` | 401 | No `Authorization: Bearer ...` header |
| `INVALID_API_KEY` | 401 | Header present but the key doesn't match any active key |
| `REVOKED_API_KEY` | 401 | Key exists but has been revoked |
| `EXPIRED_API_KEY` | 401 | Key exists but is past its `expiresAt` |
| `INSUFFICIENT_SCOPE` | 403 | Key doesn't have the scope this endpoint requires |
| `RATE_LIMITED` | 429 | Too many requests for this key — see `Retry-After` |
| `INVALID_REQUEST` | 400 | Malformed JSON or a field failed validation |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds the endpoint's size limit |
| `AGENT_NOT_FOUND` | 404 | `agent` slug doesn't resolve to an agent in your organization |
| `RUN_NOT_FOUND` | 404 | no run with that trace id exists for that agent (graph endpoints) |
| `AGENT_NOT_AUTHORIZED` | 403 | The API key is bound to a different agent (or, on `/agents/register`, a bound key tried to register a new agent) |
| `PLAN_LIMIT_REACHED` | 403 | `/agents/register` would exceed the organization plan's agent limit |
| `AGENT_CONNECTION_DISCONNECTED` | 409 | The agent's connection was disconnected in Aegis — reconnect it before sending more activity (see `docs/connect-agent.md`) |
| `APPROVAL_NOT_FOUND` | 404 | Approval id doesn't resolve in your organization |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same `Idempotency-Key` reused with a different body |
| `INVALID_PARENT_EVENT` | 400 | `parentEventId` doesn't reference an event this key can access |
| `PARENT_TRACE_MISMATCH` | 400 | Explicit `traceId` conflicts with the parent's / evaluation's trace |
| `INVALID_EVALUATION_REFERENCE` | 400 | `evaluationId` isn't an evaluation of this agent |
| `BASELINE_NOT_FOUND` | 404 | `?version=N` doesn't exist for this agent |
| `CLIENT_EVENT_ID_CONFLICT` | 409 | `clientEventId` already recorded for this agent with different content |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | A request with this `Idempotency-Key` is still running — retry shortly (same key) to receive its result |
| `POLICY_EVALUATION_FAILED` | 502 | The policy engine could not complete (rare; logged server-side) |
| `INTERNAL_ERROR` | 500 | Unexpected server error — never leaks a stack trace |

## Rate limiting

60 requests/minute per API key. A `429` response includes `Retry-After`
(seconds), `x-ratelimit-limit`, and `x-ratelimit-remaining` headers.

Since P0 the counter is shared across all server instances in production
(`lib/rate-limit/postgres.ts` — one atomic upsert per request in the
`rate_limit_buckets` table), selected by `RATE_LIMIT_BACKEND`
(`postgres` default in production, `memory` elsewhere). It fails open on a
database error. The `RateLimiter` interface still allows a Redis/Upstash
implementation to replace it without call-site changes.

## Idempotency

Pass `Idempotency-Key` on `POST /api/v1/events`, `/evaluate`, or
`/agents/register` to make a retry safe (the SDK sends one automatically
per call since 0.5.0). The same key with an **equivalent** body replays the
original response — a retried `/evaluate` call never creates a second
evaluation or `ApprovalRequest`. The same key reused with a **different**
body is rejected (`409 IDEMPOTENCY_KEY_CONFLICT`) as a caller bug.

The key is **claimed before** the request runs (P0), so concurrent retries
with the same key can't both execute: the loser gets
`409 IDEMPOTENCY_KEY_IN_PROGRESS` and should retry. Records expire after
24 hours, after which the key may be reused. Only successful completions
are cached — if the request fails, the claim is released so a retry runs it
again. Requests without a key are never deduplicated (repeated executions
are legitimate).

## Behavioral memory (P2)

Read-only, scope **`behavior:read`** (included by default in keys created
after P2; existing keys don't have it). Agent-bound keys can read only their
own agent. Full methodology: `docs/AEGIS_P2_BEHAVIORAL_MEMORY.md`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/agents/:slug/behavior` | `{ baseline: { version, maturity, windowStart, windowEnd, eventsObserved, activeDays, activeHours, computedAt, … }, profile, recentDeviations }` |
| `GET /api/v1/agents/:slug/behavior/baselines?limit=30` | `{ baselines: [...] }` version history |
| `GET /api/v1/agents/:slug/behavior/baselines?version=N` | one immutable historical version incl. `profile` (`404 BASELINE_NOT_FOUND`) |
| `GET /api/v1/agents/:slug/behavior/deviations?days=7&limit=50` | `{ deviations: [{ kind, subject, day, confidence, maturity, baselineVersion, explanation, observed, expected, eventId, occurrences, firstSeenAt, lastSeenAt }] }` |
| `GET /api/v1/agents/:slug/behavior/history?days=28` | `{ history: [{ day, events, records, bytes, distinctTools, distinctDestinations, deviations }] }` |

`maturity` is `NEW_AGENT`, `LIMITED_HISTORY`, or `ESTABLISHED`. Invalid
query parameters are `400 INVALID_REQUEST`.

## Agent trust (P3)

Read-only, scope **`trust:read`** (included by default in keys created after
P3; existing keys don't have it). Agent-bound keys can read only their own
agent. Trust is **informational**: nothing here changes an `/evaluate`
decision. Full methodology: `docs/AEGIS_P3_AGENT_TRUST.md`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/agents/:slug/trust` | `{ trust: { state, score, stateSince, evaluatedAt, methodologyVersion, headline } }` |
| `GET /api/v1/agents/:slug/trust/reasons` | `{ state, score, evidenceScore, headline, factors: [{ key, category, code, points, summary, at, evidence: [{ type, id }] }], limits, categories, omittedFactors, thresholds }` |
| `GET /api/v1/agents/:slug/trust/history?limit=20&before=<sequence>` | `{ transitions: [{ sequence, occurredAt, direction, previousState, newState, previousScore, newScore, trigger, triggerRef, summary, factors, limits, changes }], nextBefore }` newest first; page with `nextBefore` |

`state` is `TRUSTED`, `NORMAL`, `DEGRADED`, `HIGH_RISK`, or `RESTRICTED`.
`direction` is `initialized`, `degraded`, `recovered`, or `shifted`. Invalid
query parameters are `400 INVALID_REQUEST`.

## Agent-bound keys (P0)

A key may be **bound to one agent** at creation (Developers → API keys →
"Agent access", or automatically for keys Aegis provisions when connecting
an agent through the custom-SDK flow). A bound key can only send that
agent's events, evaluate its actions, and read its approvals; it gets
`403 AGENT_NOT_AUTHORIZED` for any other agent, and can't register new
agents (calling `/agents/register` with its own agent's name still returns
that agent). Keys created as "All agents" are organization-wide. The
organization is always the key's organization — never a request field.

## Key format & hashing

Keys look like `aegis_live_<32-char secret>` or `aegis_test_<...>` (~144
bits of entropy). Only a SHA-256 hash of the full key is ever stored —
authentication looks it up by that hash directly (a plain unique-index
hit), not a slower per-row comparison. SHA-256 rather than bcrypt is a
deliberate choice: bcrypt's deliberate slowness defends low-entropy human
passwords against brute-force, which a 144-bit random secret doesn't need.
The dashboard only ever shows a short, non-authenticating `prefix` (e.g.
`aegis_live_9f3a2b1c`) after creation — the full key is shown exactly once,
at creation time, and cannot be retrieved again.

## Agent action graph (P6)

Read-only, scope **`graph:read`** (included by default in keys created after
P6; existing keys don't have it — create a new key). Agent-bound keys can read
only their own agent; another organization's agent or trace is `404`. Only
observable action and context metadata is returned — reasoning-shaped context
fields are withheld. Every response is bounded and paginated. Full model and
limits: `docs/AEGIS_P6_ACTION_GRAPH.md`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/agents/:slug/graph/runs?days=7&limit=20&cursor=` | `{ runs: [{ traceId, firstAction, taskId, events, firstAt, lastAt, blocked, approvalRequired, maxRisk, tools, destinations }], nextCursor, windowDays, since, scanTruncated, ungroupedEvents }` newest first; `days` 1–30, `limit` 1–50 |
| `GET /api/v1/agents/:slug/graph/runs/:traceId?limit=100&cursor=` | `{ traceId, agent, stats, graph: { nodes, edges, timeline, attention, counts }, page: { size, returned, cursor, nextCursor } }`; `limit` 1–500; `404 RUN_NOT_FOUND` |

Out-of-range `days` / `limit` are `400 INVALID_REQUEST`.

## Policy simulation (control plane)

`POST /api/v1/simulate` — "what would Aegis do if this happened?" The **same body
as `/evaluate`** (`approvalRequestId` is rejected), answered **without executing
anything**: nothing is recorded, no approval is opened or consumed, no alert is
raised, and the agent's trust and history are untouched. Returns
`{ simulation: { recorded: false, decision, decisionSource, reason, policyDecision, agent, effective, matched, behavior, trust, risk, riskControl, approval, enforcement, stages[] } }`
— `stages` explains the decision in precedence order (KILL_SWITCH, PERMISSION,
POLICY, BEHAVIOR, TRUST, RISK, RISK_CONTROL, APPROVAL) and `enforcement.note` says
plainly that Aegis *returns* decisions and cannot guarantee they are honored.

For CI / policy-as-code testing and governance tooling. **Opt-in scope
`policy:simulate`, organization-wide keys only** — the explanation reveals how risk is
detected, so an agent's own (bound) key is refused (`403 AGENT_NOT_AUTHORIZED`) even
if it somehow held the scope. Parity with the real engine is tested across a
scenario matrix. See `docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md` §7.

## Agent inventory (control plane)

`GET /api/v1/agents` — the organization-wide inventory: per agent its identity,
owner, lifecycle, **derived** posture (`PROTECTED`, `OBSERVED`, `QUIET`,
`DISCOVERED`, …) and adoption stage, access summary (permissions by decision, broad
grants), trust, behavioral deviations, pending approvals, open incidents, identity
protection (`ISOLATED` / `BOUND_SHARED` / `ORG_WIDE_ONLY` / `NO_KEY`), 7-day decisions,
and **enforcement coverage** — plus an organization `summary`. Query: `page`,
`pageSize` (1–100), `environment`, `status`, `posture`, `flag`, `q`; invalid values are
`400`. Every number is a count of stored rows over the last 7 days. **Opt-in scope
`agents:read`, organization-wide keys only.**

## Scopes

Every key is created with the default scope set (`events:write`, `policy:evaluate`,
`approvals:read`, plus `behavior:read`, `trust:read` and `graph:read` for keys created
after those phases). The **admin** scopes `policy:simulate` and `agents:read` are
**opt-in**: tick "Admin tooling access" when creating an *All agents* key. They can
never be granted to a key limited to one agent, and the endpoints refuse bound keys
at request time as well. Each endpoint checks its required scope against the key's
`scopes` array.

## CORS

None of these endpoints set CORS headers — they are not callable from
browser JavaScript on another origin, by design. This API and the SDK are
for server-side agent runtimes. **Never ship an API key to a browser** —
anyone viewing your page's source could extract it and act as your
organization.
