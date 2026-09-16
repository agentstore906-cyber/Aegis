# Changelog

This package follows [Semantic Versioning](https://semver.org/). Additive,
backward-compatible changes bump the minor version; nothing here has ever
required a breaking major bump yet.

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
