# Aegis — Connect Agent end-to-end audit (2026-10-05)

Question: **does Connect Agent work with a real external agent, start to finish?**
Method: read the code path, then run a real separate agent process against a real running server and a disposable
Postgres database, and assert on database rows and HTTP responses — not on HTTP 200 alone.

- Harness: `lib/agents/__tests__/real-agent-e2e.integration.test.ts` (opt-in: needs `AEGIS_E2E_BASE_URL` and `DATABASE_URL_TEST`)
- External agent: `scripts/e2e/real-agent.mjs` — its own OS process, uses only the published SDK (`packages/agent-sdk/dist`) and the credential Aegis issued
- Server: `next build` + `next start -p 3100` with `DATABASE_URL` = local `aegis_test` (never the remote Neon DB)
- Nothing in the test writes `AgentConnection`/`ActivityEvent` rows or marks anything connected. Allowed scaffolding: the organization/user
  rows, the policy under test, and revoking/expiring a key to test rejection.

## 1. Current architecture

| Piece | Where |
|---|---|
| Connect Agent UI | `components/agents/agent-connection-wizard.tsx`, `connect-agent-wizard.tsx`, `components/agents/connection/*`, `app/(dashboard)/agents/new` |
| Create identity + credential | `connectProviderAgent` (`lib/agents/connection-service.ts`) — Agent + `AgentConnection(CONNECTING)` + `ApiKey` bound to the agent, one transaction, under a per-org lock |
| Authentication | `withApiAuth` (`lib/api/handler.ts`) → `authenticateApiKey` (SHA-256 lookup, revoked/expired checks) → scope → Postgres rate limit |
| Agent binding | `apiKeyMayActAsAgent` (`lib/api-keys/agent-binding.ts`), `resolveAuthorizedAgent` (`lib/api/agent-access.ts`) |
| Handshake / contact evidence | `lib/agents/handshake.ts` (`recordHandshake`, `touchConnection`); `POST /api/v1/connect/handshake` |
| Ingestion | `POST /api/v1/events` → `ingestActivityEvent` (`lib/activity/ingest.ts`) |
| Decisions | `POST /api/v1/evaluate` → `evaluateAgentAction` (kill switch → policy → risk) |
| State shown in UI | `lib/agents/connection-state.ts` (pure, derived from stored evidence), `GET /api/agents/:slug/connection` |
| Lifecycle | `disconnectAgentConnection`, `reconnectAgentConnection` |
| Retries | `lib/api/idempotency.ts` (claim-first `Idempotency-Key`), `clientEventId` dedup |

## 2–4. Flow, authentication, handshake

1. Dashboard "Connect agent" creates the agent, a connection in `CONNECTING`, and a key bound to that agent. The raw key is shown once; only its hash is stored.
2. The agent runs with `AEGIS_API_KEY`. It calls `POST /api/v1/connect/handshake` (or simply sends its first event).
3. The server authenticates the key → organization → bound agent. **The request body cannot name the agent**; the agent is the key's agent.
4. `CONNECTING → CONNECTED` happens in one guarded `updateMany` (concurrent first requests establish exactly one connection), sets `firstHandshakeAt`/`lastSeenAt`, writes one `agent.handshake` audit event. `lastSeenAt` is rewritten at most once a minute.
5. The UI state is derived: `WAITING` until a request authenticated with the agent's own key arrived; org-wide keys never count as contact.

## 5–7. Identity, ingestion, authorization

- Identity = agent row + bound key. Organization always comes from the key, never the request.
- The `agent` slug in a body is a *claim*, resolved **inside the key's organization** and checked against the key's binding. Same slug in two organizations resolves independently (tested).
- Org-wide keys (explicitly created "All agents") may act as any agent in their org; they cannot handshake and never mark anyone connected. The control inventory flags shared identities.

## 8. Monitoring

Events land on the correct agent (`organizationId`, `agentId` asserted per row), update `lastActiveAt`, feed behavior/trust/risk. State `RECEIVING` only if reported events exist.

## 9. Enforcement — monitoring vs. control (exact mechanism)

- **Aegis is not in the agent's data path.** `/evaluate` returns `ALLOW | BLOCK | REQUIRE_APPROVAL | ALERT`; it cannot stop a tool call by itself.
- **Real enforcement exists only in-process:** SDK `guard()` — authorize, run the tool only on an allowing decision, fail closed if Aegis is unreachable. Proven: with a `BLOCK` policy, the guarded tool body **did not run**; the same agent calling `authorize()` and ignoring the `BLOCK` **did run** the tool. So: `BLOCK` = a recorded decision that a cooperating integration honours, never "prevented" unless routed through `guard()`.
- No gateway/proxy that sits in front of tool APIs exists (the word only appears in approvals/enforcement type comments).
- UI wording is honest: states are "Asks Aegis" / "Monitoring only"; there is deliberately no "Protected" label (`agent-protection-status.tsx`, `control-badges.tsx`). The internal posture enum value `PROTECTED` renders as "Asks Aegis".
- Default is **deny**: an agent with no matching permission/policy gets `BLOCK (DEFAULT_DENY)` — fail-closed, but a new agent that starts asking for decisions is blocked until an allow policy exists.

## 10–12. Disconnect, reconnect, revocation

- Disconnect: revokes the connection's key and the connection → `REVOKED`; nothing is deleted. Old key → `401 REVOKED_API_KEY`. A *different* valid key bound to the same agent → `409 AGENT_CONNECTION_DISCONNECTED` on events/evaluate/handshake.
- Reconnect (SDK agents): same agent row, **new key, old key stays dead**, state is `WAITING` (not CONNECTED) until the agent really makes contact; history intact. Reconnect itself never marks connected.
- Expired key → `401 EXPIRED_API_KEY`.

## 13. Findings

### Fixed
1. **[P1 reliability — would break real customers] Connect Agent could not connect the Nth agent on every limited plan.** Each SDK agent gets its own bound key, but that key was counted against the plan's *API-key* limit (Free: 3 agents, **2** keys; Startup 25/5; Growth 100/20; Business 500/100). The 3rd Free agent was created with *no credential* and could never authenticate (`apiKeyLimitReached`). Reproduced by the e2e test (`[true, true, false]`). Fix: keys that an `AgentConnection` points to are the agent's identity and are limited by the agent limit; `countPlanLimitedApiKeys` (`lib/api-keys/repository.ts`) counts only the rest, used by connect, reconnect, the API-keys page/action and billing usage. Developer-created keys are still limited exactly as before.

### Not broken (verified, with evidence)
Agent A key → Agent B: 403. Agent A key → register new agent: 403. Org A key → Org B's agent: resolved in Org A only, Org B untouched. Invalid / malformed / missing key: 401. Revoked: 401. Expired: 401. Body-smuggled `organizationId`/`agentId`: ignored or rejected (400) — the test accepts either — and an event can only land on the key's agent only. Duplicate `Idempotency-Key`: one event (same id replayed); same key + different body: 409. Duplicate `clientEventId`: one row, `duplicate: true`. Repeated handshake: one audit event.

### Security risks (open, not code bugs)
- Bearer keys: no request signing or nonce. A stolen key can replay until revoked. Mitigations: revocation, expiry, per-key rate limit, idempotency. Keys are shown once and stored hashed (unsalted SHA-256 is fine for 144-bit random secrets).
- Org-wide keys are cross-agent by design; they can attribute events to any agent in the org. Prefer bound keys (the default from Connect Agent).
- After **disconnect**, other still-valid keys bound to that agent are refused on `/events`, `/evaluate`, `/handshake` (tested), but this audit did **not** test whether they can still call the read-only agent endpoints (approvals/behavior/trust/graph). Treat as unverified.
- Idempotency body hash uses `JSON.stringify` (key-order sensitive): a retry that reorders fields gets a 409 instead of a replay. Safe (fails visibly), minor.
- `touchConnection` failures are swallowed by design (never fail the request); a persistent DB fault there would leave the agent in `WAITING` while events still arrive.

## 14. Test results

| | Result |
|---|---|
| Real-agent e2e (real server + external process), 17 tests | **17/17 pass** (3 initial failures: 2 were my test errors — default-deny and a malformed body; 1 was the key-limit defect above, now fixed) |
| Existing connection/API integration (`lib/agents lib/api-keys lib/api lib/activity`) | 112/112 before the fix; 79/79 in `lib/agents` after (incl. new key-limit test) |
| Full suite (test DB) | 1356 pass, 4 fail on first run — all in `p2-behavioral-memory` / `p3-agent-trust`; both files pass in isolation (22/22 ×2, 34/34). Known time/concurrency-sensitive tests; the p2 file also passes with my changes stashed. Not caused by this change as far as I can tell |
| SDK tests | 54/54 |
| `tsc --noEmit` | clean |
| eslint (touched areas + e2e files) | clean |
| `next build` | clean (against local DB) |
| Browser UI of the wizard | **not exercised** — state logic is unit-tested (`connection-state.test.ts`) and the status route has its own integration test, but I did not drive the wizard in a browser |

## 15. Remaining limitations / product gaps

1. **No in-path enforcement.** Control exists only where the agent routes calls through `guard()`. Coverage is shown, not assumed. A gateway/proxy mode would be the way to enforce for agents that do not cooperate.
2. **First-run is a wall of BLOCKs.** Connected agents that ask for decisions are default-denied until an allow policy exists; Connect Agent does not offer a "start by observing"/suggested-policy step.
3. **Is `@aegis/agent-sdk` installable by a customer?** The on-screen instructions import it; I could not verify it is published to a registry. The raw HTTP (`curl` handshake) path is real and tested.
4. **No heartbeat.** Connected means "contacted recently"; an idle agent turns `NOT_SEEN_RECENTLY` after 24 h. Honest, but not liveness.
5. **Provider connectors (OpenAI/Anthropic)** are `CREDENTIAL_VERIFIED` only — no activity flows from them; they are not equivalent to an SDK connection.
6. The e2e test leaves its organizations in the disposable test DB (evidence tables are append-only by trigger), which slows other tests that scan all agents; use a fresh test database for clean full runs.

## How to re-run the e2e

```
wsl -d Ubuntu -u root service postgresql start        # keep a `sleep` alive
DATABASE_URL=postgresql://aegis:aegis@localhost:5432/aegis_test npx prisma migrate deploy
DATABASE_URL=<same> npx next build
DATABASE_URL=<same> RATE_LIMIT_BACKEND=postgres npx next start -p 3100
AEGIS_E2E_BASE_URL=http://localhost:3100 DATABASE_URL_TEST=<same> npx vitest run lib/agents/__tests__/real-agent-e2e
```

---

## Update — simplified Connect Agent experience (same day)

### What the customer sees now
`/agents/new` is two screens: **(1) name your agent → Connect agent** (environment is under "Advanced options"; the
existing OpenAI/Anthropic path stays under "Advanced setup"), then **(2) "Your agent is ready to connect"** — the
credential (masked, shown once), one **Copy setup** button (a ready-to-paste snippet with the real key, SDK or curl),
and a live "Waiting for your agent…" indicator that switches to **Agent connected → View agent** only when the backend
reports a request authenticated with that agent's own credential. The old intro screen and the "Recommended: Simple
connection" step were removed. There is no connection-method selector: there is exactly one real mechanism (SDK or plain
HTTP with a bound key), and **there is no Gateway in this codebase**, so none is offered. Free Risk Scanner is not part of this flow.

### Identity is derived from the credential (new)
Customers no longer need an agent identifier at all. `agent` is now **optional** on `/events` and `/evaluate`:
a key bound to one agent *is* that agent (`resolveAuthorizedAgent`, `lib/api/agent-access.ts`). If `agent` is sent it is
only a claim and must be the key's agent (403 otherwise); an organization-wide key must name one (400 `AGENT_REQUIRED`).
`/simulate` (org-wide keys only) still requires it. SDK 0.8.x types make `agent` optional (type-only change, `dist` rebuilt).
The external test agent now sends no identifier and is still recognised as the correct agent.

### Heartbeat
There is no separate heartbeat endpoint: `POST /api/v1/connect/handshake` is idempotent and doubles as one (it refreshes
`lastSeenAt`, written at most once a minute); any event/evaluate also refreshes it. Tested by moving `lastSeenAt` 10 minutes
into the past (time travel only) and confirming a real handshake advances it. Liveness is still "contacted recently", not a socket.

### Added tests
Real-agent e2e is now 19 tests (+ identity derived/spoof/org-wide-key, + heartbeat); wizard component tests assert no
identifiers/handshake/token jargon on the first screen and no success wording before contact.

### Verification honesty
The browser-driven walkthrough of the new wizard against the running server was **not completed**: sign-in worked after setting
`AUTH_TRUST_HOST=true` for the local production-mode server, but the automated browser then stuck on a Chrome error page, so I
stopped rather than keep retrying. The wizard is verified by component tests (static render) plus the real HTTP e2e; its client-side
polling transition (waiting → connected) is covered by `useConnectionStatus`/`connection-state` unit tests and the status
route integration test, not by a live browser run. Run `/agents/new` by hand once before release.

---

## Update — Connect Agent copy and honesty pass (UX only)

No change to authentication, identity, isolation, ingestion or the policy engine. Changes:
- **SDK wording.** `npm view @aegis/agent-sdk` returns 404: the package is not published. The Connect screens no longer say `npm install`. The default setup is plain HTTP ("Any language", nothing to install), and "Copy setup" copies a ready-to-run handshake + first-event (`agent.started`) with the real key. The SDK tab is labelled "early access" and says it is not on a public registry. The developer quickstart (`app/(dashboard)/developers/quickstart`) and public docs (`app/(marketing)/docs/sdk`) still say `npm install @aegis/agent-sdk` and were deliberately not touched in this pass — they need the same correction.
- **Connected screen.** "Agent connected / <name> / Connected just now / View agent". "Monitoring is active." appears only once a real event has arrived; otherwise "Monitoring starts when your agent reports its first event."
- **Default-deny made understandable.** A read-only `hasAllowRule` on the connection snapshot (permission for the agent, or an active ALLOW policy that applies to it). When false, the connected screen adds "No policy currently allows this agent's actions" + Configure policies; nothing about the decision engine changed.
- **Copy.** Page: "Connect your AI agent — Connect your agent to Aegis in under 60 seconds." Form: Agent name → Continue → "Your agent is ready". Home: "+ Connect Agent". OpenAI/Anthropic path is "Advanced connection options".
- **Tests.** 27 component tests (SDK wording, default-deny note, no "Protected"/"blocked" claims) and a 20th real-agent e2e test that runs the page's exact commands (empty-body handshake + `agent.started`) against the real server.

---

## Update — verification pass (2026-10-06)

- **Closed the "unverified" item from §13.** After disconnect, a second still-valid key bound to that agent can read
  only its own agent's read-only endpoints (history stays readable; nothing is writable), gets 403 for a sibling agent and
  404 for an agent that exists only in another organization. New e2e test (21 total).
- **Real e2e re-run** against a freshly built production server (`next start`, local `aegis_test`) with the external
  agent process: 21/21 pass.
- `tsc --noEmit` clean; eslint 0 errors (4 pre-existing unused-var warnings); `next build` clean; SDK tests 54/54.
- **Full suite:** 1347 pass, 3 fail (p2 ×2, p3 cron). They are not caused by Connect Agent: on a *fresh* database p2 is
  22/22 (twice, with and without my changes) and p3 is 34/34 when run alone; they fail when the two files run together
  and, for the p3 cron test, when the DB holds many leftover e2e organizations (it evaluates every agent).
  Run the full suite on a fresh database for a clean result.
- Still **not** done: a browser-driven walkthrough of the wizard (client-side polling transition is covered by unit
  tests + the status-route integration test, not a live browser).
