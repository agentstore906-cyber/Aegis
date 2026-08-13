# @aegis/agent-sdk

The official TypeScript SDK for [Aegis](../../README.md) — the control
plane for AI agents. Lets a real agent process authenticate, report
activity, and ask for an authorization decision before acting.

Zero runtime dependencies. Built on global `fetch`/`AbortController`, so it
targets Node 18+ server-side runtimes. **Never use this from a browser** —
see [Security](#security).

## Install

```bash
npm install @aegis/agent-sdk
```

## Initialize

```ts
import { Aegis } from "@aegis/agent-sdk";

const aegis = new Aegis({
  apiKey: process.env.AEGIS_API_KEY!,
  baseUrl: process.env.AEGIS_BASE_URL!, // e.g. "http://localhost:3000" in dev
});
```

Get an API key from your Aegis dashboard's **Developers → API Keys**.

## Report an event

```ts
await aegis.track({
  agent: "finance-agent",
  eventType: "TOOL_CALL",
  action: "invoice.read",
  resource: "invoice",
  status: "SUCCESS",
  metadata: { invoiceId: "inv_123" },
});
```

## Ask for authorization

```ts
const result = await aegis.authorize({
  agent: "finance-agent",
  action: "refund.issue",
  resource: "payment",
  environment: "production",
  context: { amount: 1250 },
});
```

`result.decision` is `"ALLOW"`, `"BLOCK"`, or `"REQUIRE_APPROVAL"` — a
discriminated union, so TypeScript narrows the rest of the fields once you
check it:

```ts
if (result.decision === "REQUIRE_APPROVAL") {
  result.approvalRequestId; // string — only exists on this branch
}
```

## The safe execution pattern

The SDK never executes a tool or resumes your agent's work on its own — it
only tells you what Aegis decided. Your code always makes the final call:

```ts
const auth = await aegis.authorize({
  agent: "finance-agent",
  action: "refund.issue",
  context: { amount: 1250 },
});

if (auth.decision === "BLOCK") {
  throw new Error("Action blocked by Aegis");
}

if (auth.decision === "REQUIRE_APPROVAL") {
  const approval = await aegis.waitForApproval({
    approvalRequestId: auth.approvalRequestId,
  });

  if (approval.status !== "APPROVED") {
    throw new Error(`Action not approved: ${approval.status}`);
  }
}

await issueRefund(); // only Aegis's caller ever invokes the real tool
```

## Waiting for a human decision

`waitForApproval` polls with capped backoff (starts at `intervalMs`,
default 1s; caps at 5s) and gives up after `timeoutMs` (default 120s — it
never waits forever unless you pass an explicitly large value):

```ts
const decision = await aegis.waitForApproval({
  approvalRequestId: result.approvalRequestId,
  timeoutMs: 120_000,
  signal: abortController.signal, // optional
});
```

Throws `AegisTimeoutError` if the request is still `PENDING` when the
deadline passes, or if `signal` aborts.

## Registering an agent

Skips a dashboard visit for a brand-new agent. Idempotent by name — calling
it again returns the same agent (`created: false`), never a duplicate:

```ts
await aegis.registerAgent({
  name: "Finance Agent",
  modelProvider: "OpenAI",
  modelName: "gpt-5",
});
```

## Trace correlation

Every `authorize()` call is tagged with a `traceId` — supply your own or
let the SDK generate one (`crypto.randomUUID()`-based). Pass the same
`traceId` through related calls to correlate them in the dashboard's
Activity and Approval detail views.

## Idempotency

Pass `idempotencyKey` to `authorize()` to make a retried call safe — the
same key with an equivalent request replays the original decision instead
of creating a second approval request:

```ts
await aegis.authorize({
  agent: "finance-agent",
  action: "refund.issue",
  context: { amount: 1250 },
  idempotencyKey: `refund-${invoiceId}`,
});
```

## Errors

| Error | Thrown when |
|---|---|
| `AegisAuthenticationError` | Missing, invalid, revoked, or expired API key |
| `AegisRateLimitError` | Rate limit exceeded, even after retries |
| `AegisValidationError` | Aegis rejected the request (bad payload, unknown agent, idempotency conflict, ...) |
| `AegisNetworkError` | The request never reached the server |
| `AegisTimeoutError` | A request, or `waitForApproval`, exceeded its deadline |
| `AegisApiError` | Any other non-2xx response |

Transient failures (429, 5xx, network errors) are retried automatically
with bounded exponential backoff (default: up to 2 retries). Other 4xx
errors are never retried — retrying a malformed request just repeats the
same failure.

## Security

- Never ship an API key to client-side/browser JavaScript. This SDK and
  the underlying API are for server-side agent runtimes only.
- The SDK does not execute tools on your behalf — see
  [The safe execution pattern](#the-safe-execution-pattern).

## Full API reference

See [`docs/api.md`](../../docs/api.md) in the main repository for every
endpoint's request/response shape and error codes.

## Development

From the repository root:

```bash
npm run build:sdk   # tsc -> dist/, with declaration files
npm run test:sdk    # vitest, mocked fetch — no network or database needed
```
