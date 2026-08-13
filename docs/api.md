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
`COMMUNICATION`, `FINANCIAL`, `SYSTEM`. `status` is `SUCCESS` (default) or
`FAILURE` — mapped internally to the dashboard's `ALLOWED`/`FAILED`
activity status, since this endpoint reports something that already
happened, not a policy decision. All fields except `agent`, `eventType`,
and `action` are optional. `metadata` is capped in size/depth/key-count by
the same sanitizer the policy engine's context uses
(`lib/policies/safe-context.ts`).

**Response** — `201`

```json
{ "id": "evt_...", "traceId": "trace_123" }
```

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

`reason` (only present on `BLOCK`) is always the same human-readable string
shown in the dashboard's evaluation detail view — policy/action names and
matched condition values only, never an internal ID or implementation
detail.

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
{ "id": "apr_...", "status": "APPROVED", "decision": "APPROVED", "resolvedAt": "2026-08-12T18:04:11.000Z" }
```

`status` is `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, or `CANCELLED`.
There is no webhook — poll this (the SDK's `waitForApproval()` does this
for you with backoff) until `status !== "PENDING"`.

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
| `APPROVAL_NOT_FOUND` | 404 | Approval id doesn't resolve in your organization |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same `Idempotency-Key` reused with a different body |
| `POLICY_EVALUATION_FAILED` | 502 | The policy engine could not complete (rare; logged server-side) |
| `INTERNAL_ERROR` | 500 | Unexpected server error — never leaks a stack trace |

## Rate limiting

60 requests/minute per API key (`lib/rate-limit/limiter.ts`), enforced by
an in-process counter. A `429` response includes `Retry-After` (seconds),
`x-ratelimit-limit`, and `x-ratelimit-remaining` headers.

**Known limitation**: the counter is per Node process. A multi-instance
deployment lets each instance independently allow up to the limit — the
`RateLimiter` interface is designed so a Redis-backed implementation is a
drop-in replacement later, without any call site changing.

## Idempotency

Pass `Idempotency-Key` on `POST /api/v1/events`, `/evaluate`, or
`/agents/register` to make a retry safe. The same key with an
**equivalent** body replays the original response — a retried `/evaluate`
call never creates a second `ApprovalRequest`. The same key reused with a
**different** body is rejected (`409 IDEMPOTENCY_KEY_CONFLICT`) as a
caller bug, not treated as a valid retry. Records expire after 24 hours.
Only successful completions are cached — a thrown error is not, so a retry
after a transient failure re-runs the handler rather than replaying the
failure.

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

## Scopes

Every key is created today with the full default scope set
(`events:write`, `policy:evaluate`, `approvals:read`) — there is no
scope-picker UI yet. Each endpoint still checks its required scope against
the key's `scopes` array, so the enforcement point is already in place for
when scoped-key creation ships.

## CORS

None of these endpoints set CORS headers — they are not callable from
browser JavaScript on another origin, by design. This API and the SDK are
for server-side agent runtimes. **Never ship an API key to a browser** —
anyone viewing your page's source could extract it and act as your
organization.
