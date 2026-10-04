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

## Convenience event methods

Thin wrappers around `track()` for common events, so you never have to look
up Aegis's internal `eventType`/`action` taxonomy — every other `track()`
field (`resource`, `metadata`, `cost`, ...) still works, and `action` stays
overridable for a more specific code:

```ts
await aegis.trackAgentStarted({ agent: "finance-agent" });
await aegis.trackToolCall({ agent: "finance-agent", tool: "CRM", resource: "contact:1" });
await aegis.trackApiCall({ agent: "finance-agent", resource: "stripe.charges.create" });
await aegis.trackDataRead({ agent: "finance-agent", resource: "invoice:inv_123" });
await aegis.trackDataWrite({ agent: "finance-agent", resource: "invoice:inv_123" });
await aegis.trackMessageSent({ agent: "finance-agent", resource: "email" });
await aegis.trackError({ agent: "finance-agent", description: "CRM lookup timed out" });
await aegis.trackPermissionChanged({ agent: "finance-agent", description: "Granted refund.issue" });
await aegis.trackAgentFinished({ agent: "finance-agent" });
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

`result.decision` is `"ALLOW"`, `"BLOCK"`, `"REQUIRE_APPROVAL"`, or
`"ALERT"` (allowed, but flagged for review) — a discriminated union, so
TypeScript narrows the rest of the fields once you check it. Every result
also carries a human-readable `reason` and a `decisionSource` (`CONTROL` =
the agent is paused/stopped in Aegis, `POLICY`, `DEFAULT_DENY`, or
`APPROVAL`):

```ts
if (result.decision === "REQUIRE_APPROVAL") {
  result.approvalRequestId; // string — only exists on this branch
}
```

## guard() — enforcement for one tool call (0.7.0)

The safe execution pattern below, in one call. `guard()` authorizes, runs your
tool **only** if Aegis allows it, and reports what happened under that
decision:

```ts
import { Aegis, AegisBlockedError, AegisApprovalRequiredError } from "@aegis/agent-sdk";

try {
  const receipt = await aegis.guard(
    { agent: "finance-agent", action: "refund.issue", resource: "order:42", tool: "billing", context: { amount: 1250 }, onApproval: "wait" },
    () => billing.refund("order:42", 1250) // runs only on ALLOW / ALERT
  );
} catch (error) {
  if (error instanceof AegisBlockedError) /* Aegis said no (or the approval was rejected); the refund did not run */;
  else if (error instanceof AegisApprovalRequiredError) /* onApproval: "throw": wait on error.approvalRequestId yourself */;
  else throw error; // includes AegisUnavailableError: Aegis was unreachable and guard() failed closed
}
```

- **Fails closed.** If Aegis is unreachable (network, timeout, rate limit, 5xx), the tool does **not** run. Pass `onUnavailable: "open"` only where an outage must not stop the work and you accept that it ran without a decision (the report is marked unguarded). A rejected request — bad key, invalid payload, unknown agent, 403 — never fails open.
- **Approvals.** With `onApproval: "wait"`, `guard()` waits for the human, then asks again with the single-use approval and runs the tool exactly once.
- **Reporting never changes the outcome.** The execution report is sent after the tool runs; if it fails, `onReportError` is called and the result (or the tool's own error) is returned unchanged — so a telemetry problem can neither mask a failure nor cause a retry that would run the tool twice.
- **What it is, honestly.** `guard()` is a refusal point inside *your* process for the calls you route through it. It does not and cannot stop code that calls the tool directly. Aegis shows that gap as each agent's *enforcement coverage* in the control view.

## The safe execution pattern

The SDK never executes a tool or resumes your agent's work on its own — it
only tells you what Aegis decided. Your code always makes the final call:

```ts
const request = {
  agent: "finance-agent",
  action: "refund.issue",
  resource: "order:42",
  context: { amount: 1250 },
};

let auth = await aegis.authorize(request);

if (auth.decision === "REQUIRE_APPROVAL") {
  const approval = await aegis.waitForApproval({
    approvalRequestId: auth.approvalRequestId,
  });
  if (approval.status !== "APPROVED") {
    throw new Error(`Action not approved: ${approval.status}`);
  }
  // Approvals are single-use and bound to this exact request: ask again with
  // the approval to receive the one ALLOW it grants.
  auth = await aegis.authorize({ ...request, approvalRequestId: auth.approvalRequestId });
}

if (auth.decision !== "ALLOW" && auth.decision !== "ALERT") {
  throw new Error(`Action blocked by Aegis: ${auth.reason}`);
}

await issueRefund(); // only Aegis's caller ever invokes the real tool
```

**Approvals are single-use (0.5.0).** An `APPROVED` status from
`waitForApproval()` is not itself permission to act: call `authorize()` again
with `approvalRequestId` and the *same* `agent`/`action`/`resource`/`tool`/
`context`. Aegis returns `ALLOW` exactly once, inside the approval's execution
window (`executionExpiresAt`, default 1 hour after approval). Reusing it, or
changing the amount, record, or action, returns `BLOCK` with an
`approvalDenialCode` such as `APPROVAL_ALREADY_USED`,
`APPROVAL_REQUEST_MISMATCH`, or `APPROVAL_EXECUTION_WINDOW_EXPIRED`. Pending
requests expire undecided after 24 hours.

**Paused / stopped agents.** If an operator pauses or stops the agent in
Aegis, every `authorize()` call returns `BLOCK` (`decisionSource:
"CONTROL"`) until it's resumed. This is what makes the dashboard kill switch
take effect for your agent — but only if your code calls `authorize()` before
acting and obeys the answer.

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

## Structured telemetry (0.6.0)

Every field is optional — send what you know, and Aegis never guesses the rest:

```ts
const decision = await aegis.authorize({
  agent: "finance-agent",
  action: "crm.export",
  service: "HubSpot",
  destination: "https://files.example-share.io/upload?token=…", // only the host is stored
  dataClasses: ["PII"],
  recordCount: 1200,
  endUserId: "user_8812", // stored only as a keyed pseudonym
});

if (decision.decision === "ALLOW") {
  await exportContacts();
  await aegis.track({
    agent: "finance-agent",
    eventType: "DATA_ACCESS",
    action: "crm.export",
    evaluationId: decision.evaluationId, // links "decided" to "done"
    clientEventId: `export-${jobId}`,    // re-sending this exact event is idempotent
    recordCount: 1200,
    status: "SUCCESS",
  });
}
```

**Parent / child events.** Pass `parentEventId` (an Aegis `id` you got back) or
`parentClientEventId` (your own `clientEventId` for the parent — it's linked
even if the parent is reported later) to build a task → tool call → API call →
result chain. A child inherits its parent's `traceId`; a conflicting `traceId`
is rejected. An event reported with `evaluationId` and no parent becomes a child
of that decision automatically.

**Normalization.** `service` and `tool` become lowercase keys ("Zendesk API" →
"zendesk-api"); `dataClasses` are case-insensitive; `destination` is reduced to
its host, IP, or email domain. Values Aegis can't normalize are rejected with a
`400`, never silently dropped.

## Trace correlation

Every `authorize()` call is tagged with a `traceId` — supply your own or
let the SDK generate one (`crypto.randomUUID()`-based). Pass the same
`traceId` through related calls to correlate them in the dashboard's
Activity and Approval detail views.

## Idempotency

Since 0.5.0, every `authorize()` and `track()` call sends an
`Idempotency-Key` automatically — generated per call and reused across that
call's own retries — so a retry after a timeout or network error can never
create a second evaluation, approval request, or event. Separate calls get
separate keys, so legitimately repeating an action is still recorded each
time.

Pass your own `idempotencyKey` when *your* code may retry the same logical
action across process restarts — the same key with an equivalent request
replays the original decision instead of creating a second approval request:

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
