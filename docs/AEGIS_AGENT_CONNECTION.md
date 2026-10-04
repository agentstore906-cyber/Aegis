# Aegis agent connection

How a real customer agent connects to Aegis, and what every connection state means.
The principle: **your agent stays yours; Aegis becomes its control layer.** Aegis never runs the agent, never
creates a demo agent, and never says "connected" because someone clicked a button.

This builds on what already existed (`AgentConnection`, agent-bound API keys, `/events`, `/evaluate`, the SDK).
It adds a handshake, evidence-based state, and a new setup flow. It does not add a second authentication system.

## 1. Connection architecture

```
Dashboard                                   Customer's infrastructure
─────────                                   ─────────────────────────
Connect → name + environment
Create credential ──► Agent row + AgentConnection(CONNECTING) + ApiKey bound to that agent
Shown once ─────────────────────────────────► AEGIS_API_KEY
                                              agent runs → POST /api/v1/connect/handshake
Aegis: authenticate key → organization → agent binding → record contact
Status screen polls GET /api/agents/:slug/connection → "Connected" only when the backend says so
                                              agent reports events → monitoring
                                              agent asks /evaluate → "asks Aegis for decisions"
```

- **Identity** = the agent row plus an API key bound to it (`ApiKey.agentId`). The organization comes from the key.
- **Connection evidence** = `AgentConnection.firstHandshakeAt` / `lastSeenAt`, set only by an authenticated request
  that arrived with that agent's own key.
- **State is derived** (`lib/agents/connection-state.ts`, pure and unit-tested), never stored as a claim.

## 2. Authentication

Unchanged: `Authorization: Bearer <key>`, hashed lookup, scopes, per-key rate limit (60/min), uniform errors
(`lib/api/handler.ts`). The handshake requires the `events:write` scope and **a key bound to an agent**.
An organization-wide key is refused (403): it does not prove which agent is calling, so it can never establish a connection.

## 3. Handshake

`POST /api/v1/connect/handshake` (body optional: `{ sdkVersion?, framework? }`, max 2 KB).

- The agent is the one the key is bound to; the body cannot name another.
- First valid contact while the connection is `CONNECTING`/`VERIFYING` moves it to `CONNECTED`, sets
  `firstHandshakeAt`, and writes one `agent.handshake` audit event. A status guard makes concurrent first requests
  establish exactly one connection.
- **Idempotent.** A retry, duplicate or replay records nothing new (`established: false`); `lastSeenAt` is written at most
  once a minute.
- A disconnected agent gets `409 AGENT_CONNECTION_DISCONNECTED`; a revoked key gets `401 REVOKED_API_KEY`.
- An agent registered through the API (no connection row) gets one created from this real contact.
- `POST /events` and `POST /evaluate` also count as contact (same function, `touchConnection`), so an agent that
  just starts reporting is recognised without calling the handshake. They also finally write `Agent.lastActiveAt`
  (it was previously never written).

## 4. Credential lifecycle

| Step | Behaviour |
|---|---|
| Issue | `connectProviderAgent` (CUSTOM_SDK) creates the agent, one `ApiKey` bound to it (name `Agent SDK — <name>`, `LIVE` for production, `TEST` otherwise) and the connection, in one transaction under the plan limits. |
| Scope | Agent-facing scopes only (`events:write`, `policy:evaluate`, `approvals:read`, `behavior:read`, `trust:read`, `graph:read`). Never `agents:read` / `policy:simulate`; a bound key cannot hold them. |
| Storage | Only a hash (`keyHash`). The raw key is returned once to the dashboard session and shown masked by default with Copy. It is never put in a URL, an audit record or the status API (tested). |
| Rotate / reconnect | `reconnectAgentConnection` revokes the old key and issues a new one in one transaction. The connection returns to `CONNECTING` (the new key has not been used), history is untouched. |
| Revoke | Disconnect revokes the key immediately and sets `DISCONNECTED`. Revoking the key from Developers › API keys is also reflected (state `REVOKED`). |

Fix made on the way: reconnect/rotate previously issued a new key but never displayed it. The agent page now shows it once.

## 5. Connection states

Derived by `deriveConnectionView` from stored evidence:

| State | Meaning |
|---|---|
| `WAITING` | Credential issued; nothing has contacted Aegis with it (also after a rotation, until the new key is used). |
| `CREDENTIAL_VERIFIED` | Provider-key connection (OpenAI/Anthropic): the provider accepted the key. The agent itself has not contacted Aegis. |
| `CONNECTED` | The agent's own credential reached Aegis and was seen in the last 24 h. |
| `NOT_SEEN_RECENTLY` | Connected before, nothing for 24 h. Explicitly not a claim that the agent is down. |
| `ERROR` | Expired key or failed health check, with the real reason. |
| `REVOKED` | Disconnected, or its key was revoked. Nothing can authenticate. |

The stored enum has no `REVOKED` or `WAITING`; they are derived (`DISCONNECTED`/revoked key, `CONNECTING`/no contact).
The backend has no `VERIFYING` step in practice, so the UI shows none.

## 6. Monitoring state

`NONE` (no reported events), `RECEIVING` (events, latest within 24 h), `QUIET` (events, none for 24 h). Counts only
events the agent **reported** (`source = "api"`).

## 7. Protection state

There is deliberately **no "Protected"**. Aegis returns decisions and is not in the agent's data path
(`docs/AEGIS_CONTROL_PLANE_ARCHITECTURE.md` §4). The UI shows:

- **Monitoring only**: Aegis sees reported activity and cannot stop actions.
- **Asks Aegis for decisions**: the agent requested decisions in the last 7 days; it still decides whether to honor them.

A test asserts no label or description in any state contains protected / prevented / enforced.

## 8. Revocation

Disconnect shows its consequences first (credential revoked at once, requests rejected, agent shows Revoked, history
kept). After revocation `CONNECTED` becomes `REVOKED` immediately (derived from `status` and the key's `revokedAt`).
Activity, decisions, audit and handshake history are retained (tested).

## 9. Reconnection

Reconnect reuses the same agent (id, slug, trust, baselines, history) and issues a new key. State is `WAITING` until
the new key is used, then `CONNECTED`; `firstHandshakeAt` keeps the original identity evidence. Tested for both
disconnect → reconnect and rotation of a live connection.

## 10. Security model

- Tenant isolation: the status API takes the organization from the session membership; a slug never resolves across
  tenants (404). The same slug in two organizations keeps separate state (tested).
- Agent authorization: a key for agent A cannot act as, or connect, agent B (403 `AGENT_NOT_AUTHORIZED`).
- Rate limiting and per-key idempotency apply as to every `/api/v1` route; the handshake is idempotent by nature.
- Replay: a replayed handshake changes nothing.
- Audit: `agent.handshake` (once per establishment), `agent.connected/reconnected/disconnected`. Metadata is redacted by the existing audit service.
- Status API returns derived fields only: no key, hash or ciphertext (tested).

## 11. API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/connect/handshake` | agent-bound API key, `events:write` | Establish / confirm the connection |
| `POST /api/v1/events`, `/evaluate` | API key | Also count as contact |
| `GET /api/agents/:slug/connection` | dashboard session | Derived connection snapshot (polled by the setup screen every 3 s while visible) |
| Server actions `connectAgentAction`, `reconnectAgentAction`, `disconnectAgentAction` | session, `manage_agents` | Issue / rotate / revoke |

## 12. SDK / Gateway integration

`@aegis/agent-sdk` 0.8.0 adds `aegis.handshake({ sdkVersion?, framework? })`. Any language can send the same single
authenticated POST. There is no gateway product in this codebase, so none is offered.

## 13. Known limitations

- **Not exercised in a browser.** The flow is covered by route-level integration tests and component render tests. On
  2026-10-04 the lifecycle was also run over real HTTP against `next dev` on the local test database (bad key 401 → handshake
  `established: true` → replay `established: false` → CONNECTED/no events → one event → monitoring RECEIVING → disconnect →
  handshake 401, REVOKED). The Chrome extension was unavailable, so the screens themselves were never driven visually.
- The setup screen polls (3 s, only while the tab is visible); there is no push channel.
- "Connected" proves a request with the agent's key reached Aegis. It cannot tell which process sent it or whether the
  agent is currently running; silence for 24 h is shown as "not seen recently".
- Provider-key connections (OpenAI/Anthropic, under Advanced setup) prove only that the provider accepted the key.
- **No auto-discovery** of agents exists, so none is shown.
- The instructions install `@aegis/agent-sdk`; whether that package is published to a registry your customers can reach is a
  release matter outside this code.
- **Production database:** the build runs `prisma migrate deploy`, which will apply `20261010120000_agent_connection_handshake`
  (two nullable columns plus a backfill from existing reported activity). It was applied only to the local test database here.
- Existing SDK connections that never reported anything now show "waiting" instead of the previous (unearned) "Connected".
