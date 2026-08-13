# Changelog

This package follows [Semantic Versioning](https://semver.org/). Additive,
backward-compatible changes bump the minor version; nothing here has ever
required a breaking major bump yet.

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
