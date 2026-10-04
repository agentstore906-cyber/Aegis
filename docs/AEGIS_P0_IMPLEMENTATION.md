# Aegis P0 — Decision & Security Correctness

**Status:** implemented and verified locally on 2026-10-01. **Not deployed.**
**Scope:** fixes to existing decision and security behavior only. There is
no behavioral baseline, trust engine, risk engine, action graph, or ML here
(those remain in `docs/AEGIS_V2_ROADMAP.md`). The architecture is unchanged:
`evaluateAgentAction()` is still the single decision entry point and
`PolicyEvaluation` is still the immutable decision record.

Migration: `prisma/migrations/20261001120000_p0_decision_correctness/`.

## Verification summary

All results below are from the final run, against a local, disposable
Postgres database (`localhost/aegis_test`). Nothing was run against the
remote Neon database configured in `.env`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (0 errors) |
| `npx eslint` | 0 errors; 2 warnings, both pre-existing in untouched files |
| Unit tests (`npm test`, no test DB configured) | **38 files, 359 tests, all passed** (integration files skipped by the guard) |
| Full suite (`DATABASE_URL_TEST=…/aegis_test npx vitest run`) | **62 files, 594 tests, all passed** |
| SDK (`packages/agent-sdk`: `vitest run`, `tsc --noEmit`, `build`) | **36 tests passed**, typecheck clean, `dist/` rebuilt |
| `npx next build` (`DATABASE_URL` → local DB) | compiled successfully, 59/59 static pages |
| Migration applied to a DB already at the previous head | applied cleanly |
| Key-rotation script, end to end on the local DB | legacy credential unreadable after `AUTH_SECRET` change → rotated with `--apply` → readable with only the new key |
| Mutation check (kill switch and strict matching temporarily disabled) | new tests failed (9 failures), confirming they detect regressions |

Baseline before any change: 52 files / 475 tests (302 unit + 173
integration), all passing. The "302 existing unit tests" requirement:
all 302 still pass. 14 of them were in two files that wrote to the
database without being named `*.integration.test.ts`, so they now run as
integration tests (see §11).

---

## §1 Kill switch now affects decisions

- **Issue.** `STOPPED` / `PAUSED` were recorded and audited, but nothing
  read `Agent.status`, so a stopped agent calling `/evaluate` still got
  `ALLOW`.
- **Root cause.** The control state and the decision path were never
  connected.
- **Fix.** `lib/policies/evaluate.ts` checks
  `isAgentHalted(agent.status)` (`lib/policies/decision-context.ts`).
  `STOPPED`, `PAUSED`, and `ARCHIVED` always produce `BLOCK` with
  `decisionSource: CONTROL`. The decision overrides every permission,
  policy, and approval. It never creates an approval request and never
  consumes an approval. The policy outcome is still computed and recorded
  in the reason ("Policy alone would have returned …") so nothing is
  hidden. `NEEDS_ATTENTION` is a review flag and evaluates normally.
  `PolicyEvaluation.agentStatus` and `decisionSource` record the state.
  The activity row is `BLOCKED`.
- **Consistent across surfaces.**
  - API: the response carries `decisionSource` and `agentStatus`.
  - SDK: types updated; README explains the behavior.
  - Dashboard: the kill-switch dialog and the `EnforcementOutcome.detail`
    now state what Aegis really does (refuses every authorization request)
    and what it can't do (halt the external process, or stop actions taken
    without asking).
  - Policy tester: uses the same engine, so it shows the same BLOCK.
- **Not faked.** `EnforcementOutcome.enforced` stays `false`. This is
  cooperative enforcement: only integrations that call `/evaluate` are
  stopped. New detector `ACTIVITY_WHILE_HALTED` raises a CRITICAL (STOPPED)
  or HIGH (PAUSED) alert when a halted agent reports a completed action
  through `/events`. It is worded as detection, never as blocking.
- **Tests.** `lib/__tests__/p0-decision-correctness.integration.test.ts` §1:
  - ACTIVE → normal decision
  - STOPPED → BLOCK/CONTROL, recorded (`agentStatus`, `decisionSource`,
    activity `BLOCKED`)
  - resume → ALLOW again
  - STOPPED with an ALLOW permission plus an explicit ALLOW policy → BLOCK
  - STOPPED with a REQUIRE_APPROVAL action → BLOCK and no approval created
  - PAUSED and ARCHIVED → BLOCK; NEEDS_ATTENTION → normal
  - halted-activity alert raised, and not raised for a self-reported
    BLOCKED action

  Other coverage:
  - `p0-routes` §1: via the HTTP route.
  - `decision-context.test.ts`: `isAgentHalted`.
  - `p0-detectors.test.ts`: the detector.
- **Behavior change.** PAUSED/STOPPED agents now receive BLOCK. This is the
  intended semantics of the button.

## §2 Policy field-omission bypass

- **Issue.** "BLOCK `payments.*` in PRODUCTION" didn't match when the caller
  omitted `environment`. The same applied to `tool`, `resource`, and
  `riskLevel` scopes, and to conditions on missing or non-numeric fields
  ("BLOCK if amount > 1000" with no `amount`). The caller's `riskLevel`
  was taken at its word, so under-declaring dodged risk-scoped policies.
  A resource-scoped BLOCK *permission* was skipped when `resource` was
  omitted.
- **Root cause.** Scope matching used equality against caller-supplied
  values, with "missing" meaning "no match" for every decision type. The
  server-side `Agent.environment` and `Agent.riskLevel` were never used.
- **Fix** (STRICT mode, the default for all orgs). Full rules are in
  `docs/policy-engine.md` "Missing and unusable fields".
  1. **Trusted context** (`buildDecisionContext`):
     - `environment` = the Agent record's value for agent callers. A
       different claim is ignored for matching and stored as
       `claimedEnvironment`.
     - `riskLevel` = max(claim, agent level, `scoreEventRisk` of the
       action). A lower claim is stored as `claimedRiskLevel`.
     - The dashboard policy tester passes `contextSource: "operator"` and
       may simulate an environment, since that is a human, not an agent
       vouching for itself.
  2. **Restrictive policies fail closed.** For BLOCK, REQUIRE_APPROVAL,
     and ALERT, a missing scope field matches. A missing, null, or
     non-comparable condition value counts as satisfied
     (`evaluateConditionStrict` returns `null`, meaning indeterminate).
  3. **ALLOW never matches on the unknown.**
  4. **Restrictive `riskLevel` scopes are thresholds** (HIGH includes
     CRITICAL). ALLOW risk scopes stay exact.
  5. **Resource-scoped restrictive permissions** are weighed in when
     `resource` is omitted; the stricter one wins.

  `PolicyEvaluation.matchingMode` is recorded on every evaluation. The
  post-hoc violation check on `/events` uses the same rules.
- **Opt-out / migration path.** `Organization.legacyPolicyMatching`
  (default `false`) restores the pre-P0 matcher for one org. It has no UI.
  Support applies it with a direct DB update (not visible in the in-app
  audit trail — log it externally). It is recorded on every evaluation as
  `LEGACY`. It never disables the kill switch, approval binding, or any
  other fix. Intended use:
  1. A customer reports unexpected BLOCK / REQUIRE_APPROVAL.
  2. Support enables LEGACY for that org.
  3. The customer fixes the integration to send complete context (or the
     agent's environment is corrected in Aegis).
  4. Support disables LEGACY.
- **Tests.**
  - `lib/policies/__tests__/strict-matching.test.ts` (21 tests): env, tool,
    and resource omission; ALLOW never widened; riskLevel thresholds;
    missing, null, and garbage conditions; EXISTS; permission omission;
    LEGACY parity.
  - `decision-context.test.ts` (10 tests).
  - Integration §2 (8 tests): end to end, including recorded claims,
    operator simulation, LEGACY, and that LEGACY can't disable the kill
    switch.
- **Behavior change.** Integrations that omit context, or whose Agent
  record has the wrong environment, may now see BLOCK or REQUIRE_APPROVAL
  where they saw ALLOW. That is the fix working, but customers need to be
  told (see "Product decisions").

## §3 Approval expiration

- **Issue.** No code path set `expiresAt`; approvals waited forever.
- **Fix.**
  - New requests get `expiresAt = now + 24h`
    (`APPROVAL_PENDING_TTL_MS`).
  - Lazy expiry now also runs when listing (`expireStaleApprovals` in
    `listApprovalRequests`) and when an agent references the request.
    Existing read and resolve paths keep their lazy expiry.
  - Expiry is conditional on `status = PENDING AND expiresAt <= now`, so
    it can't clobber a concurrent human decision. It is audited as
    `approval.expired`.
  - Resolving an expired request throws `ApprovalExpiredError`, as before.
  - `/evaluate` returns `approvalExpiresAt`; `GET /approvals/:id` returns
    `expiresAt`.
- **Migration.** Legacy PENDING rows without a deadline get
  `GREATEST(requestedAt + 24h, migration time + 24h)`. Nothing is
  mass-expired at deploy time, and nothing waits forever.
- **Tests.** Integration §3: deadline set; listing flips overdue rows to
  EXPIRED and approval is then refused; an agent referencing an expired
  request gets BLOCK/`APPROVAL_EXPIRED` and the row flips; `resolveApproval`
  refuses expired. The pre-existing approvals tests still pass.

## §4 Single-use approval bound to the exact request

- **Issue.** `APPROVED` was a reusable status. Nothing tied it to the
  request that was approved or limited it to one execution.
- **Fix** (`lib/approvals/binding.ts`, `evaluate.ts`, `service.ts`).
  - `requestFingerprint` is a SHA-256 of canonical JSON (sorted keys)
    covering agent, action, resource, effective environment, tool, and
    redacted context. It is stored at creation.
  - Approval sets `executionExpiresAt = approval + 1h`.
  - The agent consumes an approval via `/evaluate` with
    `approvalRequestId` and the same request.
    - A pure pre-check gives a precise reason code.
    - Inside the decision transaction, a conditional
      `updateMany WHERE status=APPROVED AND consumedAt IS NULL AND
      requestFingerprint=$fp AND executionExpiresAt > now` claims it.
      Postgres row locking makes this race-safe: exactly one concurrent
      attempt sees `count = 1`.
    - `consumedByEvaluationId` (unique) and the `approval.consumed` audit
      event record the use. Refusals are audited as
      `approval.consumption_denied`.
  - Mismatched agent or request never consumes the approval.
  - A still-pending reference returns REQUIRE_APPROVAL with the same id,
    so no duplicate request is created.
  - Kill switch and BLOCK policies still win. An approval only satisfies
    REQUIRE_APPROVAL.
  - Concurrent human resolution was already race-safe and is unchanged.
- **Migration / historical approvals.** Legacy rows have a null
  fingerprint and can **never** be consumed (`APPROVAL_LEGACY_UNBOUND`).
  No historical approval becomes a reusable token. Their polled status is
  unchanged.
- **Tests.** `binding.test.ts` (12 tests). Integration §4 (8 tests):
  - consume → ALLOW once, recorded and audited
  - replay → `APPROVAL_ALREADY_USED`
  - different amount, record, or agent → mismatch, approval not consumed
  - **6 concurrent consumers → exactly 1 ALLOW**, `consumedByEvaluationId`
    = the winner
  - pending reference → same request, no duplicate
  - rejected → refused
  - execution window closed → refused
  - legacy unbound → refused
  - kill switch beats a valid approval, which stays unconsumed
- **Honest limit.** An integration that acts on a polled `APPROVED`
  without consuming is not stopped, because it never asks. See the SDK
  0.5.0 "safe execution pattern".

## §5 Alert deduplication preserves evidence

- **Issue.** A repeat trigger overwrote `evidence` and `severity` (it could
  downgrade CRITICAL to HIGH). Title, description, and traceId stayed from
  the first trigger, so they mismatched the evidence. Different
  actions or policies of the same type collapsed into one alert. Two
  concurrent triggers could create duplicate alerts.
- **Fix** (`upsertAlertFinding`).
  - A new `SecurityAlertOccurrence` row is written for **every** trigger,
    first and repeat: time, severity, confidence, title, description,
    redacted evidence, traceId. Rows are append-only.
  - The alert row keeps the **original** evidence, title, description,
    and traceId.
  - `count` and `lastSeenAt` still summarize. Severity only escalates.
    Confidence keeps the strongest.
  - New `dedupeKey` per finding (`action:…`, `tool:…`, `namespace:…`,
    `policy:…`, `budget:…`) keeps distinct findings apart. Agent-wide
    spikes keep `""`.
  - Find-or-create runs in a transaction under
    `pg_advisory_xact_lock(hashtext(identity))`.
  - The alert detail page shows the occurrence history (latest 50 plus a
    total), and the summary evidence is labeled "first occurrence".
- **Migration.** Each existing alert gets one backfilled occurrence from
  its current evidence. Evidence already overwritten before P0 cannot be
  recovered. This is stated, not hidden.
- **Tests.** Integration §5:
  - CRITICAL then HIGH → stays CRITICAL; count 2; 2 occurrences with
    their own evidence and trace; original evidence kept; secrets
    redacted
  - escalation to a worse severity
  - different keys → separate alerts
  - **5 concurrent identical findings → 1 alert, count 5, 5
    occurrences**

  `p0-detectors.test.ts` covers the dedupe keys.

## §6 Idempotency

- **Issue.**
  - The SDK sent no Idempotency-Key unless the caller did, yet retried
    5xx responses. A failure after commit (for example, the ALERT alert
    write throwing) became a 502, which caused a retry and a duplicate
    evaluation or approval.
  - Server-side check-then-write let two in-flight requests with the same
    key both run.
- **Fix.**
  - Server (`lib/api/idempotency.ts`): **claim first**. The record is
    inserted before the handler runs (unique key, `completedAt` null), and
    the loser gets `409 IDEMPOTENCY_KEY_IN_PROGRESS`. Failure releases the
    claim. Expired records, and abandoned claims older than 5 min (crashed
    process), are cleared so the key isn't wedged.
  - `evaluate.ts`: post-commit side effects can no longer throw. The ALERT
    write is wrapped; detectors and webhooks are deferred.
  - SDK 0.5.0: `authorize()` and `track()` send a per-call key, reused
    across that call's retries, and retry `IDEMPOTENCY_KEY_IN_PROGRESS`
    with the same key. Legitimate repeats (separate calls) get separate
    keys and are each recorded.
- **Tests.**
  - `p0-routes` §6 (7 tests): sequential replay = one evaluation and one
    approval; **6 concurrent same-key requests → exactly 1 evaluation and
    1 approval**; body conflict → 409; no key or different keys → 4
    separate evaluations; failure releases the claim; fresh in-progress
    respected and stale claim reclaimed; expired key reusable.
  - SDK (6 new): key reused across retries, distinct per call, `track`
    key, in-progress retried, conflict not retried, `approvalRequestId`
    passthrough.

## §7 Agent authorization for API keys

- **Issue.** Any valid key could send events, evaluate, and read approvals
  for any agent in the org by naming its slug.
- **Fix.**
  - `ApiKey.agentId`: a bound key may act only as that agent.
  - `lib/api-keys/agent-binding.ts` holds the pure rules, also re-checking
    org ownership. `lib/api/agent-access.ts#resolveAuthorizedAgent` is
    used by `/events` and `/evaluate` and returns
    `403 AGENT_NOT_AUTHORIZED`.
  - `GET /approvals/:id` reports other agents' approvals as 404, so a
    bound key can't probe them.
  - `/agents/register`: bound keys can't create agents. Registering their
    own agent's name is still idempotent.
  - The dashboard key form has an "Agent access" selector. The posted
    agent id is re-verified to belong to the org. Binding is audited in
    `api_key.created` metadata. The key list shows the binding.
  - Keys auto-provisioned by the Connect flow (custom SDK) and on
    reconnect are bound to their agent.
  - Org always comes from the key; scopes and role checks for key
    management are unchanged.
- **Migration.** Keys referenced by exactly one `AgentConnection.apiKeyId`
  (provisioned for that agent) are bound. Manually created keys stay
  org-wide ("All agents").
- **Tests.**
  - `agent-binding.test.ts` (4).
  - `p0-routes` §7 (6): bound key works for its own agent; 403 for
    another agent's events and evaluate (and nothing recorded); 404 on
    another agent's approval; can't register others but can re-register
    itself; cross-tenant same slug resolves to the caller's own org only;
    approval fields exposed.

## §8 Plan agent limit

- **Issue.** `/api/v1/agents/register` never checked the limit. The
  dashboard Connect flow checked it outside the creating transaction, so
  it was racy.
- **Fix.** `lib/agents/creation-guard.ts#checkAgentLimitLocked` takes a
  per-org transaction advisory lock and counts inside the same transaction
  as the insert. Both creation paths use it. Register returns
  `403 PLAN_LIMIT_REACHED`. Existing agents (register-by-name) are returned
  without counting, so they keep working at or over the limit. Bound keys
  can't register at all.
- **Tests.** `p0-routes` §8 (4):
  - **4 concurrent registrations for the last slot → exactly 1 created**
  - at limit → 403, nothing created
  - existing agent still registers and ingests
  - bound key can't bypass

## §9 Webhook / side effects off the decision path

- **Issue.** Webhook delivery (3 attempts × 5 s timeout + backoff,
  ~16.5 s worst case), ~25 detector queries, alert writes, and budget
  checks all ran before `/evaluate` and `/events` responded.
- **Fix.**
  - `lib/server/defer.ts` uses Next.js 16 `after()` (verified in
    `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`).
    Outside a request scope (tests, scripts) the task runs immediately,
    tracked for `drainDeferredTasks()`. Errors are logged and never thrown.
  - `dispatchWebhookEvent` now snapshots the redacted payload and defers
    delivery. This covers every caller.
  - Detectors for both evaluate and ingest are deferred.
  - The decision, its record, the approval request, and the ALERT
    evidence stay synchronous.
- **Durability tradeoff.** This is still best-effort, the same as before.
  `after()` is bounded by the route's `maxDuration`, and a crashed process
  loses its pending side effects (now including detector runs). A durable
  outbox needs a scheduler (roadmap P0-2) and was deliberately not built.
- **Tests.**
  - `p0-routes` §9: with a 700 ms, always-503 webhook endpoint,
    `/evaluate` returns in < 1.5 s (inline delivery took ~3.6 s), then all
    3 delivery attempts complete and are logged.
  - `defer.test.ts` (3).
  - Existing ingest, budget, and webhook tests now drain deferred work.
    The setup file drains after every test.

## §10 AUTH_SECRET rotation

- **Issue.** Provider credentials were encrypted with a key derived only
  from `AUTH_SECRET`, with no key id. Rotating the session secret silently
  made every stored credential unreadable.
- **Fix** (encryption is unchanged: AES-256-GCM, random 96-bit IV, scrypt
  derivation for the legacy key).
  - Versioned keyring in `lib/connectors/credential-keyring.ts`
    (`crypto.ts` re-exports it behind `server-only`).
    - `CONNECTOR_ENCRYPTION_KEYS` holds dedicated 32-byte keys; the first
      is primary.
    - Otherwise the `AUTH_SECRET`-derived key is used, with id
      `as-<hash8>`.
    - `AUTH_SECRET_PREVIOUS` holds former secrets, decrypt-only.
  - `AgentConnection.credentialKeyId` records which key encrypted each
    row. Legacy null rows try the current and previous AUTH_SECRET keys.
    GCM authentication guarantees a wrong key fails loudly.
  - Decrypting with a non-primary key re-encrypts lazily (conditional on
    unchanged ciphertext).
  - `scripts/rotate-connector-credentials.ts` re-encrypts in bulk: dry run
    by default, `--apply` to write, conditional updates, never prints
    secrets.
  - An unreadable credential now marks the connection
    `RECONNECT_REQUIRED` with an actionable message instead of crashing
    the health check.
  - Malformed key configuration throws; it never falls back to weaker
    behavior.
- **Tests.**
  - `lib/connectors/__tests__/crypto.test.ts` (10): round trip and IV
    uniqueness; tamper detection; AUTH_SECRET rotation fails without
    PREVIOUS and succeeds with it, then re-encrypt and drop the old secret;
    legacy null-keyId rows; dedicated key independent of AUTH_SECRET;
    k1→k2 rotation; legacy→dedicated migration; unknown key id message;
    malformed config rejected.
  - Manual end-to-end script run on the local DB (see summary).
- **Not changed.** `AUTH_SECRET` minimum length is still `min(1)`.
  Requiring 32+ characters could stop an existing deployment from booting.
  This is listed under product decisions.

## §11 Integration-test safety

- **Issue.** Integration tests used `DATABASE_URL` from `.env`, currently
  a remote Neon database, and `deleteMany` in cleanup.
- **Fix.**
  - `lib/testing/test-db-guard.ts` (pure, unit-tested) is applied in
    `vitest.config.mts`. Integration tests run **only** against
    `DATABASE_URL_TEST`, which must:
    - differ from every app `DATABASE_URL` (compared by host, port, and
      database, not raw string)
    - have a database name containing "test"
    - if non-local, be confirmed with `AEGIS_ALLOW_REMOTE_TEST_DB=<exact
      host>`

    Unsafe configuration aborts the run.
  - Without `DATABASE_URL_TEST`, `*.integration.test.ts` files are
    excluded with a warning, and workers get an unreachable sentinel
    `DATABASE_URL`.
  - A setup file re-asserts the worker's URL before any test.
  - New script: `npm run test:unit`.
- **Found by the guard.** `lib/onboarding/__tests__/status.test.ts` and
  `app/api/webhooks/paddle/__tests__/route.test.ts` wrote to the database
  but weren't named as integration tests. They would have hit the Neon DB
  under `npm test`. They are renamed `*.integration.test.ts`, and doc
  references are updated.
- **Tests.** `test-db-guard.test.ts` (7).
- **Production data.** Never touched. All integration runs used local
  `aegis_test`, and the build ran against the local DB.

## §12 Rate limiting

- **Issue.** The in-memory limiter is per instance, so it is nearly
  meaningless on Vercel.
- **Fix.**
  - `PostgresRateLimiter` (`lib/rate-limit/postgres.ts`): a fixed window
    using one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING count` in
    the new `rate_limit_buckets` table, shared by all instances. Expired
    rows are swept opportunistically.
  - `createRateLimiter()` selects the backend via `RATE_LIMIT_BACKEND`
    (default `postgres` in production, `memory` elsewhere).
  - Used for the API limiter and, since they are security controls on
    serverless too, the sign-in, sign-up, and lead-form limiters.
  - The `RateLimiter` interface is unchanged, so Redis/Upstash can replace
    it without call-site changes.
- **Tradeoffs.**
  - One extra small write per API request.
  - Fails **open** on DB error (logged). Limiting protects capacity and
    isn't an authorization boundary, and a request can't succeed with the
    DB down anyway.
  - Window-boundary bursts of up to 2× the limit, as before.
- **Tests.** Existing `InMemoryRateLimiter` tests are unchanged and pass.
  The Postgres limiter is **not** directly tested; its SQL is exercised
  only by the production build.
  - To verify locally: run the app with `RATE_LIMIT_BACKEND=postgres`.
  - Gap: add an integration test (listed under remaining risks).

---

## Migration

`20261001120000_p0_decision_correctness`.

**Schema changes** (all additive, nullable, or defaulted):

| Table | New columns |
|---|---|
| `organizations` | `legacyPolicyMatching` |
| `agent_connections` | `credentialKeyId` |
| `policy_evaluations` | `decisionSource`, `agentStatus`, `matchingMode`, `claimedEnvironment`, `claimedRiskLevel`, `consumedApprovalRequestId` |
| `approval_requests` | `requestFingerprint`, `executionExpiresAt`, `consumedAt`, `consumedByEvaluationId` (unique) |
| `api_keys` | `agentId` (FK, cascade) |
| `idempotency_records` | `completedAt` |
| `security_alerts` | `dedupeKey` (index changed to `agentId, type, dedupeKey`) |

New tables: `security_alert_occurrences`, `rate_limit_buckets`.

**Backfills** (idempotent):
- Pending approvals get a deadline (§3).
- Connection-provisioned keys are bound (§7).
- Idempotency records are marked complete.
- One occurrence is created per existing alert (§5).

**Deploy order.** `npm run build` runs `prisma migrate deploy` before
`next build`, so the schema is ready before new code serves traffic. The
old code ignores the new columns, so a brief overlap is safe.

**Rollback.** Reverting the code is safe with the migrated schema. Do not
drop the new columns without first deciding what happens to the occurrence
history.

## Backwards compatibility

**API.** All response fields are additive. `reason` now appears on every
decision. New error codes: `AGENT_NOT_AUTHORIZED`, `PLAN_LIMIT_REACHED`,
`IDEMPOTENCY_KEY_IN_PROGRESS`.

**SDK 0.5.0.** Additive, plus one type change: `AlertResult` was added to
`AuthorizationResult`. The server could already return `ALERT`.

**Intentional behavior changes.** Each is a fix:
- halted agents are blocked
- strict matching (with the legacy opt-out)
- approvals expire after 24h and must be consumed for a recorded single
  execution
- connection-provisioned keys are agent-bound
- `register` enforces the plan limit
- webhooks and detector alerts arrive moments after the response instead
  of before it

## Remaining risks

1. **Enforcement is still cooperative.** Agents that don't call
   `/evaluate`, or ignore it, aren't stopped. They are only detected if
   they report the action.
2. **Approvals.** Integrations that act on a polled `APPROVED` without
   consuming aren't stopped, and leave no single-use record.
3. **Self-registered agents set their own trusted context.** An org-wide
   key holder can register an agent with any `environment`/`riskLevel`.
   That record then becomes the "trusted" context. Mitigations: bind keys,
   and review agents created via API.
4. **Existing manually created keys stay org-wide** until customers rebind
   them.
5. **Deferred side effects are best-effort.** A crash or `maxDuration`
   cutoff can lose webhooks and detector alerts. There is no durable
   outbox yet.
6. **Postgres rate limiter.**
   - It has no direct automated test.
   - It adds a DB write per request.
   - It fails open.
7. **No retention for new tables.** `security_alert_occurrences` grows
   with every trigger, including spike detectors firing per event.
   `rate_limit_buckets` and `idempotency_records` are only cleaned
   opportunistically or per key. There is still no scheduler.
8. **Wider BLOCK / REQUIRE_APPROVAL than before.**
   - Strict matching and the server-side risk floor (keyword heuristics)
     may produce these where customers previously got ALLOW.
   - Risk-scoped restrictive policies now cover higher levels too.
9. **Fingerprint collisions on secrets.** The fingerprint uses the
   *redacted* context, so two requests differing only in a secret-shaped
   value are treated as the same request.
10. **Advisory-lock collisions.** Locks use 32-bit `hashtext`. A collision
    only causes extra serialization, never incorrect results.
11. **`AUTH_SECRET` length** is not enforced.
12. **`.env.example` is gitignored** by `.env*`, so its new entries aren't
    tracked. The new variables are documented in `docs/deployment.md`.

## Product decisions needed

1. **Strict matching rollout.** Ship strict to every org at once (current
   default), or pre-notify customers? Who may set `legacyPolicyMatching`,
   and for how long?
2. **PAUSED semantics.** Currently BLOCK, the same as STOPPED. The
   alternative is "PAUSED → REQUIRE_APPROVAL".
3. **Approval TTLs.** Pending 24h and execution window 1h are constants.
   Should they be per-org or per-policy settings?
4. **Binding existing keys.** The migration binds only
   connection-provisioned keys. A customer using one of those keys for
   several agents will get 403s. Notify customers, or skip this backfill?
5. **Org-wide keys.** Should new keys default to agent-bound, and should
   org-wide keys need an elevated role?
6. **Key requirements.**
   - Make `CONNECTOR_ENCRYPTION_KEYS` required in production?
   - Enforce `AUTH_SECRET` ≥ 32 characters?
7. **Rate-limit failure mode.** Fail open (current), or fail closed for
   the sign-in limiter?
8. **Unconsumed approvals.** Should `APPROVED` approvals that are never
   consumed raise an alert?
