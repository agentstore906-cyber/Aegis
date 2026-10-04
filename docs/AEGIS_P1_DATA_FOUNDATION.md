# Aegis P1 — Agent Data Foundation

**Status:** implemented and verified locally on 2026-10-02. **Not deployed.**
This builds on P0 (`docs/AEGIS_P0_IMPLEMENTATION.md`), which is also uncommitted
and undeployed.

**Scope.** P1 collects the right structured telemetry, reliably, privately,
and immutably. That is all it does. It does **not** add behavioral baselines,
trust, a unified risk engine, an action-graph UI, or ML (see
`docs/AEGIS_V2_ROADMAP.md`). Nothing here changes an authorization decision,
with one exception: the approval fingerprint now also covers the new
telemetry (§6).

**Migration:** `prisma/migrations/20261002120000_p1_agent_data_foundation/`.

## Verification

All runs used the local disposable database `localhost/aegis_test`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` | 0 errors; 2 warnings, both pre-existing in files P1 didn't touch |
| `npm test` (no test DB, unit tests only) | **43 files, 413 tests, all passed** |
| Full suite (`DATABASE_URL_TEST=…/aegis_test`) | **68 files, 675 tests, all passed** |
| SDK 0.6.0 | 37/37 passed, typecheck clean, `dist/` rebuilt |
| `npx next build` (`DATABASE_URL` → local DB) | compiled, 59/59 static pages |
| Migration applied on top of the P0 schema | applied; the existing 594 tests still passed with the new triggers active |
| Mutation check: raw `endUserId` stored instead of the pseudonym | caught by tests |
| Mutation check: cycle protection removed | caught by tests |

**New tests: 82.**

| Test file | Tests | Covers |
|---|---|---|
| `lib/__tests__/p1-data-foundation.integration.test.ts` | 27 | end-to-end through the API routes |
| `lib/telemetry/__tests__/normalize.test.ts` | 14 | |
| `lib/validation/__tests__/api-telemetry.test.ts` | 18 | including 14 malformed-input cases |
| `lib/security/__tests__/redact-values.test.ts` | 11 | |
| `lib/telemetry/__tests__/signals.test.ts` | 5 | |
| `lib/telemetry/__tests__/pseudonymize.test.ts` | 4 | |
| `lib/approvals/__tests__/binding.test.ts` | +2 | telemetry in the approval fingerprint |
| SDK | +1 | |

---

## 1. Schema changes

The changes are all on `ActivityEvent`. It stays the single event table: both
`/events` rows and `/evaluate` decision rows. There is no parallel model.

| Field | Type | Populated from | Notes |
|---|---|---|---|
| `clientEventId` | text | caller | Unique per **(organization, agent)**. Drives dedup and parent references. |
| `parentEventId` | text (FK → `activity_events`, ON DELETE SET NULL) | resolved server-side | The column existed but was never written. It now has a real FK and index. |
| `parentClientEventId` | text | caller | Kept as reported, for late linking. |
| `evaluationId` | text (FK → `policy_evaluations`, SET NULL) | caller, validated | Links an execution to the decision it ran under. |
| `occurredAt` | timestamp | caller, validated window | `timestamp` stays Aegis's receipt time, which is the trusted ordering. |
| `environment` | `Environment` | **server** (the agent's record) | Never caller-supplied. Null on pre-P1 rows (unknown, not backfilled). |
| `toolKey` | text | normalized from `toolName` | Backfilled. `toolName` keeps the display spelling. |
| `service` | text | caller, normalized key | |
| `destination`, `destinationKind` | text, `DestinationKind` (`HOST`/`IP`/`EMAIL_DOMAIN`) | caller, normalized | Host or domain only. |
| `endUserHash` | text | keyed HMAC of caller `endUserId` | The raw value is never stored. |
| `dataClasses` | `DataClass[]` (default `[]`) | caller, normalized | `PUBLIC` `INTERNAL` `CONFIDENTIAL` `PII` `FINANCIAL` `HEALTH` `CREDENTIALS` |
| `dataSensitivity` | `RiskLevel` | **derived** from classes; caller may only raise it | Null = unknown. |
| `recordCount`, `byteCount` | int | caller | `byteCount` is capped at 2³¹−1, documented. Integers rather than BigInt avoid JSON-serialization hazards. |
| `outcome` | `EventOutcome` (`SUCCESS`/`FAILURE`/`BLOCKED`/`WARNING`) | caller's reported status | Separated from `status`, which mixes decision and result. **Null on decision rows** (nothing executed yet). Backfilled for pre-P1 `/events` rows. |
| `riskSignals` | JSON `[{code, detail}]` | server | Deterministic observations. Evidence, not a score (§7). |

**New indexes:**
- unique `(organizationId, agentId, clientEventId)`
- `(parentEventId)`
- `(agentId, parentClientEventId)`
- `(evaluationId)`
- `(agentId, toolKey)`
- `(agentId, destination)`

**Covered elsewhere (not duplicated):**
- **Covered by existing columns:**
  - agent → `agentId`
  - organization → `organizationId`
  - action → `action`
  - tool → `toolName`/`toolKey`
  - request id → `traceId`, `clientEventId`, and the P0 idempotency key
- **Available by relation, not duplicated:**
  - decision and policy context → `PolicyEvaluation` (decision, matched-policy
    snapshots, decision source, approvals)
  - for a decision row: via `PolicyEvaluation.activityEventId`
  - for an execution: via `evaluationId`

**Deliberately not added:**
- Prompt or completion text and full URLs, because they are sensitive and not
  needed.
- A monetary `amount` column (it stays in `context`/`metadata`).
- Data-class *inference* from text, because it can't be populated reliably.

## 2. Event lifecycle

```
POST /api/v1/events
  1. authenticate key → scope → rate limit                (P0 handler)
  2. key → agent authorization                            (P0 §7)
  3. Idempotency-Key claim (optional)                     (P0 §6)
  4. validate + NORMALIZE every field at the boundary     lib/validation/api.ts → 400 if not normalizable
  5. clientEventId dedup: same agent + same id → return original (200, duplicate) / conflict 409
  6. resolve lineage: parent / evaluation, tenant- and agent-scoped   lib/telemetry/lineage.ts
  7. privacy: key-based + value-based redaction; endUserId → pseudonym
  8. risk level (unchanged rules) + risk signals recorded
  9. ONE insert; if it has a clientEventId: same transaction links children that arrived first
 10. response
 11. after the response: detectors / alerts / webhooks    (P0 §9, lib/server/defer.ts)
 → from step 9 on, the row is append-only (DB trigger)

POST /api/v1/evaluate
  same boundary normalization; lineage resolved BEFORE the decision (bad reference → 400, nothing recorded);
  the decision's ActivityEvent stores the same structured context (outcome = null), and the approval
  fingerprint binds it (§6).
```

## 3. Parent / child model

```
task.run (clientEventId "task-7")
 └─ tool.call            parentClientEventId "task-7"
     └─ api.call         parentEventId <id of tool.call>
         └─ crm.export   (decision row from /evaluate, parentEventId …)
             └─ crm.export  (execution, evaluationId → parent defaults to the decision row)
```

**Two ways to reference a parent:**
- `parentEventId` is Aegis's id. The parent must already exist in the same
  organization; with an agent-bound key it must also belong to the same agent.
  Otherwise the call fails with `400 INVALID_PARENT_EVENT`, which prevents
  dangling references.
- `parentClientEventId` is the caller's own id, resolved **within the same
  agent**. If the parent exists, it is linked at once. If not, the child
  stores the reference and is linked when the parent arrives, in the same
  transaction as the parent's insert. Telemetry often arrives out of order,
  and this keeps it without losing structure. Until then the link is
  *pending*, not orphaned; the reference is preserved and the UI says so.

**Invariants:**
- **Trace consistency.** A child inherits the parent's `traceId`. An explicit
  conflicting trace is rejected on a direct link (`PARENT_TRACE_MISMATCH`)
  and skipped on a late link. Events are never silently re-traced.
- **No cycles.** A late link never makes an event its own ancestor. This is
  checked with one bounded recursive query (depth limit 64).
- **Write once.** A link only ever goes from NULL to a value. The trigger
  forbids re-pointing it.
- **Decision to execution.** An execution reported with `evaluationId` and no
  explicit parent becomes a child of that decision's event and inherits its
  trace.
- **Reads are tenant-scoped at every step.** `getEventLineage(orgId, id)`
  returns ancestors (root first, bounded) plus direct children. The activity
  detail page shows them as links: data display, not the Action Graph UI.

## 4. Immutability

**Enforced in the database.** Trigger function `aegis_enforce_append_only`
runs BEFORE UPDATE on the tables below. It applies to every client,
including ad-hoc SQL and future code. INSERT and DELETE stay allowed
(organization deletion, future retention).

| Table | The only permitted UPDATEs |
|---|---|
| `activity_events` | `parentEventId` NULL → value, once (late link); `parentEventId` / `evaluationId` → NULL (ON DELETE SET NULL) |
| `policy_evaluations` | `activityEventId` → NULL (SET NULL) |
| `audit_events` | `actorUserId`, `agentId` → NULL (SET NULL) |
| `approval_decisions` | none |
| `security_alert_occurrences` | none |

**What stays mutable, and why.** These are workflow state, not evidence. Their
transitions are audited, and the evidence about them lives in the immutable
tables:
- `SecurityAlert` summary: count, status, acknowledgement.
- `ApprovalRequest`: status, consumption.
- `Agent`.

The public API has no endpoint that modifies or deletes an event.

**Limit.** A database owner can drop or disable a trigger. This protects
against application bugs and casual rewriting, not against a compromised
database superuser.

## 5. Normalization

All in `lib/telemetry/normalize.ts`, applied at the API boundary.

| Concept | One representation |
|---|---|
| Tool | `toolKey`: lowercase; runs of `[^a-z0-9._-]` become `-`; dashes collapsed and trimmed; max 60. `"HubSpot CRM"`, `"hubspot  crm"`, `"HUBSPOT-CRM"` → `hubspot-crm`. `_` and `.` are kept, so different spellings aren't guessed to be the same product. The SQL backfill mirrors it exactly, verified by a parity test against Postgres. The Activity tool filter and new-tool detection now use it ("CRM" after "crm" is no longer a "new tool"). |
| Service | same key function |
| Destination | URL, host, or email → lowercase host (punycode for IDNs), IP, or email domain. Never path, query, fragment, userinfo, or port. A stray `@` without a scheme is rejected. |
| Environment | the existing enum (case-insensitive input), and on events the agent's own server-side value |
| Data types | `DataClass` enum, case-insensitive, de-duplicated, stable order; unknown → 400 |
| Sensitivity | fixed mapping: PUBLIC=LOW, INTERNAL=MEDIUM, CONFIDENTIAL/PII/FINANCIAL=HIGH, HEALTH/CREDENTIALS=CRITICAL. Max over classes; a declaration can raise but not lower it. |
| Action | already normalized (lowercase dot-namespaced, `actionSchema`) |
| Action type | already the `ActivityType` enum |
| Result | `EventOutcome`, a single mapping from the reported status |

## 6. Idempotency

**Reuses the P0 architecture and adds one layer:**
- **Idempotency-Key (P0).** Claim-first, scoped to the API key. The SDK sends
  one per call, which makes the SDK's own retries safe.
- **`clientEventId` (P1).** The *logical* identity of an event, unique per
  agent. A re-delivery, for example from the agent's own retry queue after a
  restart with a new idempotency key, returns the original row: `200`,
  `duplicate: true`, nothing written.
  - **Content check.** Same id with different content (event type, action,
    resource, or outcome) is `409 CLIENT_EVENT_ID_CONFLICT`.
  - **Concurrency.** Concurrent deliveries resolve through the unique index;
    the loser returns the winner's row.
- **No id, no dedup.** Events without either identifier are never
  deduplicated, because repeated actions are real.

**Approval binding (decision path).** The P0 approval fingerprint now
includes `service`, `destination`, `dataClasses`, `recordCount`, `byteCount`,
and `endUserHash` when present. An approval for 1 record to `pay.example.com`
can't be consumed for 5,000 records or another destination. Requests without
telemetry fingerprint exactly as before.

## 7. Risk signals

`riskSignals` records what was *observed*, deterministically, at
ingest/decision time. It changes no decision and no score; it is raw material
for P2/P3.

| Code | Meaning |
|---|---|
| `risk_rule` | which `scoreEventRisk` rule fired |
| `agent_risk_floor` | the agent's configured level raised the event's risk |
| `claimed_risk_lower` / `claimed_environment_ignored` | an evaluate caller's claim was overridden (P0 trusted context) |
| `sensitive_data` | HIGH+ data sensitivity |
| `secret_shaped_fields` / `secret_values_redacted` | counts and kinds only, never values |
| `executed_despite_decision` | an execution reported SUCCESS/WARNING under a BLOCK or REQUIRE_APPROVAL decision. Recorded as an observation only; turning it into an alert is a P2+ decision. |

## 8. Privacy decisions

| Data | What Aegis stores |
|---|---|
| `endUserId` | `<keyId>:<32 hex>` = HMAC-SHA256(key, orgId ‖ id). Stable per org, unlinkable across orgs, not reversible by guessing without the key. Key: `TELEMETRY_HASH_KEY`, else derived from `AUTH_SECRET`. Changing the key changes the pseudonyms (continuity loss, never exposure). |
| `destination` | host / IP / email domain only |
| `description`, `metadata`, evaluate `context` | key-based redaction (P0) **plus** value-based redaction of unambiguous credential formats (JWT, PEM private keys, `sk-`/`sk-ant-`/`sk-proj-`, Stripe, GitHub, AWS access key ids, Slack, Google API keys, Aegis keys, Bearer tokens, `scheme://user:pass@`). Only counts and kinds are recorded as signals. |
| `resource`, `action` | unchanged: identifiers used for policy matching are not rewritten |
| prompts / completions | never requested or stored |

**Sensitive fields.** Even after processing, treat these as sensitive:
- `resource`, `description`, and `metadata`, which are caller-written free
  text.
- `endUserHash`, which is a pseudonym: personal data under GDPR-style
  regimes.
- `destination` (a customer's partner domain).
- `context`.

**Honest limits.**
- Value-based redaction is defense in depth. A secret with no recognizable
  format, sent under an innocuous key, is still stored.
- Free text such as `resource: "jane@example.com"` is stored as sent.
- There is no retention enforcement yet (see P0: no scheduler).

## 9. Performance

**Decision path vs. telemetry path.**
- `/evaluate` adds a parent lookup only when a parent is referenced, plus
  pure CPU work (normalization, an HMAC, regex redaction).
- Detectors, alerts, and webhooks remain after the response (P0 §9).

**Ingest queries.**
- A minimal event is still **one INSERT**. No transaction is opened unless a
  `clientEventId` is present.
- The optional extras are indexed point lookups:
  - `clientEventId` dedup check
  - parent lookup
  - evaluation lookup
  - for events with a `clientEventId`: a bounded recursive ancestor query
    plus one indexed `updateMany` to link waiting children
- The append-only trigger runs only on UPDATE; INSERT is unaffected.

**Measured locally.** WSL Postgres, in-process route handlers, 40 sequential
requests each. These numbers include auth, key lookup, and rate limiting.
They are indicative, not production numbers:

| Path | median | p90 |
|---|---|---|
| `/events`, minimal | 20.4 ms | 37.1 ms |
| `/events`, every P1 field + `clientEventId` + parent | 37.9 ms | 50.5 ms |
| `/evaluate`, minimal | 38.7 ms | 42.9 ms |
| `/evaluate`, with telemetry + parent | 40.5 ms | 45.8 ms |

There was no pre-P1 measurement, so these are absolute numbers, not a
before/after comparison.

**Write amplification.** Six new indexes on `activity_events`. All are
narrow; the unique and `parentClientEventId` indexes hold mostly NULLs.

## 10. Migration

`20261002120000_p1_agent_data_foundation`:

1. **Schema:** enums `EventOutcome`, `DataClass`, `DestinationKind`; 16
   nullable or defaulted columns; 6 indexes.
2. **Cleanup:** clears any pre-existing `parentEventId` that points nowhere
   (the app never wrote one), then adds the parent FK and the evaluation FK.
3. **Backfills** (deterministic derivations only):
   - `toolKey` from `toolName`
   - `outcome` for `source = 'api'` rows from `status`
   - `environment` is **not** backfilled (unknown historically)
4. **Triggers:** the append-only trigger function and 5 triggers.

**Deployment notes:**
- Run after the P0 migration.
- `npm run build` applies it via `prisma migrate deploy`.
- Rollback: reverting the code is safe with the migrated schema. To allow
  manual data repair, drop the triggers explicitly; that is deliberate
  friction.

**Compatibility:**
- **API.** Every new field is optional. The `/events` response adds
  `parentEventId` and `duplicate`. The response is `200` (not `201`) only for
  a `clientEventId` duplicate.
- **Behavior changes:**
  - The Activity page's tool filter lists normalized keys.
  - Approval-resolution activity rows now say `source: "approval_resolution"`
    instead of the misleading default `"api"` (historical rows unchanged).
  - Malformed new fields are rejected (400).
- **SDK 0.6.0** adds the fields (additive).

## Remaining limitations

1. **Telemetry quality depends on the integration.** Every P1 field is
   caller-declared, except environment, receipt time, the normalizations,
   and the derived sensitivity. Aegis records what it is told; it does not
   verify that an agent's `dataClasses` or `recordCount` are true.
2. **Policies can't use the new fields yet.** There are no conditions on
   destination, data class, or volume; that is P2+.
3. **Pending parent links stay unresolved** until the parent arrives. There
   is no expiry or sweep for references that will never resolve.
4. **Value-based redaction is format-limited** (see §8).
5. **`executed_despite_decision` is only recorded** as a signal; it raises no
   alert.
6. **The immutability triggers can be bypassed by a database owner.**
7. **No retention or cleanup scheduler**, as in P0.
8. **Not verified against Neon.** The new indexes and triggers were measured
   only on local Postgres. Neon behavior is expected to match (standard
   PL/pgSQL), but it hasn't been tested there.
