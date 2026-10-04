# Approvals & Audit trail (Phase 3)

This document covers the code in `lib/approvals/` and `lib/audit/`, the
`ApprovalRequest` / `ApprovalDecision` / `AuditEvent` tables, and how they
extend the Phase 2 policy engine (see [`docs/policy-engine.md`](policy-engine.md))
into a real human-in-the-loop workflow.

## The flow

```
Agent requests action
        |
        v
evaluateAgentAction()            lib/policies/evaluate.ts
        |
        v
PolicyEvaluation persisted       (unchanged from Phase 2)
        |
        v
decision === REQUIRE_APPROVAL?  --no-->  done (ALLOW / BLOCK, as before)
        | yes
        v
ApprovalRequest created           lib/approvals/repository.ts
  (same transaction as the evaluation + its ActivityEvent)
        |
        v
AuditEvent: "approval.requested"  lib/audit/service.ts
        |
        v
Authorized human reviews          /approvals, /approvals/[id]
        |
        v
resolveApproval() — APPROVE or REJECT   lib/approvals/service.ts
        |
        v
ApprovalDecision created (immutable) + AuditEvent + ActivityEvent
        |
        v
Everything visible in /audit, /activity, and the agent's Approvals tab
```

Phase 2 already did everything down to "PolicyEvaluation persisted." Phase 3
is everything from "ApprovalRequest created" onward.

## Data model

**`ApprovalRequest`** — one per `PolicyEvaluation` that resolved to
`REQUIRE_APPROVAL`. Carries a point-in-time snapshot of the action (action,
resource, environment, tool, risk, context, and the engine's `reason`) so it
reads correctly even if the agent, policy, or permission that produced it
later changes. Status: `PENDING -> APPROVED | REJECTED | EXPIRED |
CANCELLED`. `CANCELLED` is modeled but not currently produced by any code
path — reserved for a future "withdraw a stale request" action.

**`ApprovalDecision`** — append-only. Aegis never overwrites or deletes a
decision; if a resolved request needs to be revisited, that's a new
`ApprovalRequest`/audit trail entry, not a rewritten one.
`decidedByUserId` uses `onDelete: Restrict` (stronger than
`Policy.createdBy`'s `SetNull`) — Aegis must never lose who made an approval
call.

**`AuditEvent`** — append-only, org-scoped, no relation back to the entity
it describes (same reasoning as `PolicyEvaluation`'s snapshot approach: the
audit record must survive the described entity being edited or deleted).
`eventType` is a plain string (see `AUDIT_EVENT_TYPES` in
`lib/audit/types.ts`) rather than a Prisma enum, so instrumenting a new kind
of event never requires a migration.

## Idempotency

The unique constraint on `ApprovalRequest.policyEvaluationId` is the
guarantee: since every `evaluateAgentAction()` call creates a brand-new
`PolicyEvaluation` row, "one evaluation → at most one approval request" is
enforced at the database level, not just in application code.

`createApprovalRequestForEvaluation` (`lib/approvals/repository.ts`) checks
for an existing row before creating rather than optimistically creating and
catching a unique-constraint violation — Postgres aborts the rest of an
interactive transaction after any failed statement, so recovering from
P2002 *inside the same transaction* isn't possible. The check-then-create
approach isn't perfectly race-safe against two fully concurrent
transactions racing on the exact same evaluation id, but in practice that
can't happen during normal operation (each evaluation id is a freshly
generated `cuid`, produced and consumed within one `evaluateAgentAction()`
transaction) — and if it somehow did, the database's unique constraint
still guarantees only one `ApprovalRequest` row can ever exist; the losing
transaction fails loudly instead of silently duplicating.

**Known limitation**: this guarantees idempotency *per evaluation*, not
across *distinct* evaluations of what a caller considers "the same logical
action" (e.g. a network retry that re-calls `evaluateAgentAction()` from
scratch). Deduplicating at that layer requires a caller-supplied
idempotency key threaded through evaluation — a Phase 4 concern once the
SDK/Gateway is ingesting real agent requests.

## Race-safe resolution

`resolveApproval` (`lib/approvals/service.ts`) uses a conditional
`updateMany({ where: { status: "PENDING", ... } })` to flip a request's
status. Under two concurrent resolution attempts, exactly one transaction's
`updateMany` matches the row (Postgres serializes the two `UPDATE`s); the
other sees `count === 0` and is told the request was already resolved.

Every branch of the transaction *returns* an outcome descriptor rather than
throwing — throwing inside `prisma.$transaction()` rolls back everything
that branch already wrote, including the lazy `EXPIRED` status flip in the
"this request expired since you loaded the page" branch. The corresponding
`ApprovalNotFoundError` / `ApprovalExpiredError` /
`ApprovalAlreadyResolvedError` is thrown once, after the transaction has
committed. This is exercised directly in
`lib/approvals/__tests__/approvals.integration.test.ts`.

## Expiration

Since P0, every request is created with `expiresAt` = request time + 24h
(`lib/approvals/binding.ts#APPROVAL_PENDING_TTL_MS`). The P0 migration gave
every legacy `PENDING` request without a deadline one at least 24h after the
migration ran. There is no scheduled job: a `PENDING` request past
`expiresAt` is flipped to `EXPIRED` lazily — when it's read
(`getApprovalRequest`), listed (`listApprovalRequests` expires overdue rows
first), acted on (`resolveApproval`), or referenced by an agent trying to
use it — each recording an `approval.expired` audit event.

### Single-use execution binding (P0)

An `APPROVED` request authorizes **one** execution of **exactly** the
request that was approved:

- At creation, Aegis stores `requestFingerprint` — a SHA-256 over the agent,
  action, resource, effective environment, tool, and (redacted) context.
- Approval opens an execution window: `executionExpiresAt` = approval time
  + 1h (`APPROVAL_EXECUTION_TTL_MS`).
- The agent consumes it by calling `POST /api/v1/evaluate` again with the
  same request and `approvalRequestId`. A conditional `UPDATE … WHERE
  consumedAt IS NULL AND requestFingerprint = … AND executionExpiresAt >
  now()` claims it atomically, so under any number of concurrent attempts
  exactly one gets `ALLOW`; the rest get `BLOCK`
  (`APPROVAL_ALREADY_USED`). `consumedAt` / `consumedByEvaluationId` and an
  `approval.consumed` audit event record the use; refused attempts record
  `approval.consumption_denied`.
- A different amount, record, tool, action, or agent never matches the
  fingerprint (`APPROVAL_REQUEST_MISMATCH` / `APPROVAL_AGENT_MISMATCH`) and
  doesn't consume the approval.
- The kill switch and BLOCK policies still win: an approval only satisfies
  a `REQUIRE_APPROVAL` outcome.
- Legacy approvals (created before P0, `requestFingerprint` null) can never
  be consumed — request a new one.

Honest limit: an integration that acts directly on a polled `APPROVED`
status without consuming it isn't stopped by Aegis (it never asks). The
consume step is what makes Aegis's `ALLOW` single-use and gives the audit
trail proof of one execution. Simpler than a scheduler, and correct for the only thing that
actually depends on the status: nothing can approve/reject a request the
system hasn't yet noticed is expired, because the flip happens as part of
the very check that would allow resolution.

## Authorization

| Action | Allowed roles |
|---|---|
| View approval requests, decisions, and history | Everyone (incl. `VIEWER`) — `canViewApprovals()` |
| Approve / reject a request | `OWNER`, `ADMIN`, `SECURITY` — `canResolveApproval()` |
| View the audit trail | Everyone (incl. `VIEWER`) |

Approval resolution is deliberately narrower than agent-permission
management (which also allows `ENGINEER`) — approvals gate consequential,
often irreversible actions (refunds, production deploys), so the same
roles that can author policies are the ones that can resolve them. Centralized
in `lib/approvals/authorization.ts`; enforced in `lib/approvals/actions.ts`
server-side, never inferred from whether a button happens to be rendered.

## Trace correlation

`ApprovalRequest.traceId` is copied from the `PolicyEvaluation`/
`ActivityEvent` that produced it, and `resolveApproval` reuses the same
`traceId` on the `ActivityEvent` and `AuditEvent` it creates. That makes the
full first half of the intended chain —

```
Agent request -> ActivityEvent -> PolicyEvaluation -> ApprovalRequest -> ApprovalDecision
```

— navigable by trace today: the Approval Detail page's "Related activity"
section (`getActivityByTraceId`, `lib/activity/queries.ts`) and its link to
the source `PolicyEvaluation` cover it. Tool execution (the remaining link
in the full Phase 4 chain) doesn't exist yet — see "What Phase 3
deliberately doesn't do" below.

## What Phase 3 deliberately doesn't do

- **Doesn't resume agent execution.** Aegis has no channel back to the
  external agent yet — that's the SDK/Gateway, Phase 4. An `APPROVED`
  request's detail page says "Approved — ready for execution," never that
  execution happened. See `getApprovalStatus()` / `approveRequest()` /
  `rejectRequest()`-shaped functions in `lib/approvals/service.ts` — these
  are exactly what a Phase 4 ingestion endpoint will call.
- **No policy-level expiration configuration.** `expiresAt` exists on the
  model and the lazy-expiry logic is fully implemented and tested, but
  nothing currently sets it.
- **No `CANCELLED` producer.** The status is modeled for a future "withdraw
  a request" action but nothing creates it yet.
- **No webhook/callback delivery.** `getApprovalStatus()` is poll-shaped
  (call it, get the current state) rather than push-shaped — a callback
  mechanism is a Phase 4 concern once there's an external client to call.
