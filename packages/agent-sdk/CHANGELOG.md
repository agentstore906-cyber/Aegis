# Changelog

This package follows [Semantic Versioning](https://semver.org/). Additive,
backward-compatible changes bump the minor version; nothing here has ever
required a breaking major bump yet.

## 0.8.0

`handshake()` — tells Aegis the agent is up. Additive.

- `aegis.handshake({ sdkVersion?, framework? })` calls `POST /api/v1/connect/handshake`. Aegis marks the agent's
  connection established only because this authenticated request arrived; it is idempotent (safe on every start).
  Requires a key bound to one agent.

## 0.7.0

`guard()` — in-process enforcement for one tool call, paired with the Aegis
control plane (docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md in the Aegis repo).
Additive; nothing existing changed.

- `aegis.guard(input, fn)`: authorize → run `fn` **only** on `ALLOW`/`ALERT` →
  report the outcome (SUCCESS/FAILURE, linked to the decision via
  `evaluationId`). `BLOCK` throws `AegisBlockedError`; `REQUIRE_APPROVAL` throws
  `AegisApprovalRequiredError` (or, with `onApproval: "wait"`, waits for the
  human and runs `fn` once under the single-use approval).
- **Fails closed**: if Aegis cannot be reached (network, timeout, rate limit,
  5xx) the tool does not run (`AegisUnavailableError`). `onUnavailable: "open"`
  is an explicit opt-in that runs the tool and marks the report unguarded. A
  rejected request (bad key, invalid payload, unknown agent, 403) never fails
  open.
- A failed execution report never changes the outcome (see `onReportError`), so
  telemetry can neither mask a result nor cause the tool to run twice.
- New errors: `AegisBlockedError`, `AegisApprovalRequiredError`,
  `AegisUnavailableError`. New type: `GuardInput`.
- `guard()` guards the calls you route through it. It cannot stop code that
  calls the tool directly; Aegis shows that gap as enforcement coverage.

## 0.6.0

Structured telemetry, paired with Aegis P1 (docs/AEGIS_P1_DATA_FOUNDATION.md
in the Aegis repo). All additive and optional.

- `track()` and `authorize()` accept `service`, `destination`, `endUserId`,
  `dataClasses`, `dataSensitivity`, `recordCount`, `byteCount`,
  `parentEventId`, `parentClientEventId`.
- `track()` also accepts `clientEventId` (your own stable event id —
  re-delivery returns the original instead of a duplicate), `evaluationId`
  (the authorize() decision this action ran under), and `occurredAt`.
- `TrackEventResult` gains `parentEventId` and `duplicate`.
- Privacy: only the host / email domain of `destination` and a keyed
  pseudonym of `endUserId` are stored server-side.

## 0.5.0

Security-correctness release, paired with the Aegis P0 server changes
(docs/AEGIS_P0_IMPLEMENTATION.md in the Aegis repo).

- **Automatic idempotency.** `authorize()` and `track()` now send an
  `Idempotency-Key` on every call (your `idempotencyKey`, or one generated per
  call) and reuse it across the SDK's own retries, so a retry can never create
  a duplicate evaluation, approval request, or event. `track()` gains an
  optional `idempotencyKey`.
- Retries (same key) when the server reports `IDEMPOTENCY_KEY_IN_PROGRESS`
  (a concurrent attempt is still running); a genuine
  `IDEMPOTENCY_KEY_CONFLICT` is still not retried.
- **Single-use approvals.** `AuthorizeInput.approvalRequestId` consumes an
  `APPROVED` approval for exactly one execution of exactly the approved
  request. See the README's updated "safe execution pattern" — integrations
  that act directly on a polled `APPROVED` status keep working, but only the
  consume step gives Aegis a record that the approval was used once.
- Results now carry `reason` (all decisions), `decisionSource`,
  `agentStatus`, `approvalExpiresAt` (REQUIRE_APPROVAL),
  `consumedApprovalRequestId` (ALLOW), and `approvalDenialCode` (BLOCK).
  `ApprovalStatusResult` gains `expiresAt`, `executionExpiresAt`, `consumed`,
  `consumedAt`. All optional/additive.
- `AuthorizationResult` now includes `AlertResult` (`decision: "ALERT"`), which
  the server could already return; code that exhaustively switches on
  `decision` may need an `ALERT` branch (treat it as allowed-and-flagged).

## 0.4.0

- Adds `trackAgentStarted()`, `trackAgentFinished()`, `trackToolCall()`,
  `trackApiCall()`, `trackDataRead()`, `trackDataWrite()`,
  `trackMessageSent()`, `trackError()`, `trackPermissionChanged()` — thin
  convenience wrappers around `track()` that fill in `eventType`/`action`
  for the common event shapes, so a custom agent's integration code never
  has to look up Aegis's internal event taxonomy. Every field `track()`
  accepts is still available, including an `action` override. No changes
  to `track()`'s own signature — fully additive.

## 0.3.0

- `track()`'s `TrackEventInput` gains two optional fields: `tool` (which
  tool/integration performed the action — feeds tool-based anomaly
  detection and the dashboard's Tool filter) and `description` (an
  optional human-readable summary shown in the activity feed instead of
  the raw `action` code).
- `TrackEventInput.status` gains `"BLOCKED"` and `"WARNING"`, alongside
  the existing `"SUCCESS"`/`"FAILURE"`, so an agent can self-report that
  its own guardrail stopped an action or that a successful action looked
  suspicious. All additive — existing `track()` calls compile and behave
  exactly as before.

## 0.2.0

- `track()`'s `TrackEventInput` gains four optional cost-intelligence
  fields: `inputTokens`, `outputTokens`, `taskId`, `taskType`. All
  optional — existing `track()` calls compile and behave exactly as
  before.
- No changes to `authorize()`, `waitForApproval()`, `registerAgent()`, or
  any error type.

## 0.1.0

- Initial release: `Aegis` client with `track()`, `authorize()`,
  `waitForApproval()`, `registerAgent()`, `getApprovalStatus()`. Typed
  errors (`AegisAuthenticationError`, `AegisRateLimitError`,
  `AegisValidationError`, `AegisNetworkError`, `AegisTimeoutError`,
  `AegisApiError`). Bounded retry with backoff on 429/5xx/network only.
