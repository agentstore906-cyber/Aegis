# Connect Agent

`lib/connectors/` + `lib/agents/connection-service.ts` — turns "register an
agent" from a free-typed metadata form into a real, verified connection to
the provider the agent actually runs on. Replaces the old manual
name/provider/model form at `/agents/new` (deleted — see
`lib/agents/actions.ts` git history) with a 3-step flow: choose a provider,
connect, done.

## Why there's no OAuth here

Neither OpenAI nor Anthropic offers a third-party OAuth flow for Platform
API access (ChatGPT's own plugin/actions OAuth is a different product and
doesn't apply here). The only genuine connection mechanism for either is a
secret API key the user provides directly — so that's what Aegis uses,
never an invented authorization flow. See `lib/connectors/openai.ts` and
`lib/connectors/anthropic.ts` for the specifics of what each provider's API
actually allows.

## The connector interface

`lib/connectors/types.ts#AgentConnector` — every provider implements the
same four operations, each honest about what it can and can't do:

- `verifyCredential` — does this credential actually authenticate?
- `discoverAgents` — list the caller's existing agents/assistants, if the
  provider's API supports it. Returns `[]` rather than inventing a result.
- `getDiscoveredAgent` — re-fetch one specific agent's authoritative
  name/model server-side, so a client is never trusted for that.
- `healthCheck` — is the connection still live?

`capabilities` (`lib/connectors/types.ts#ConnectorCapabilities`) is a
snapshot of what's true for that connector, persisted on
`AgentConnection.capabilities` at connect time and rendered directly in the
UI (`components/agents/agent-connection-panel.tsx`) — never show an
affordance a connector doesn't list as `true`.

| Connector | Discovery | Credential | Notes |
|---|---|---|---|
| `OPENAI` | `GET /v1/assistants` (beta Assistants API) | Secret API key | Many accounts have zero Assistants objects (Responses API doesn't use them) — that's reported as zero, not papered over. |
| `ANTHROPIC` | None — no such API exists | Secret API key | `GET /v1/models` verifies the key only; the user names the agent. |
| `CUSTOM_SDK` | None | None (uses the existing `ApiKey`/SDK pipeline) | See `lib/agents/register.ts` / `packages/agent-sdk`. |

Every connector's `activityMonitoring` capability is `true` for the same
reason: the receiving end (`POST /api/v1/events`) is live the moment an
`Agent` row exists, regardless of provider. That's "the pipe is
connected," not "data is flowing" — an agent with zero events still shows
`AgentConnectPanel`'s honest "waiting for the first activity" state
(`app/(dashboard)/agents/[slug]/page.tsx`). No connector here can pull
usage/cost or enforce a pause/kill directly from the provider — those stay
`false` until a real mechanism exists (OpenAI/Anthropic's usage/cost APIs
need a separate admin-level credential this connection doesn't have).

## Credential storage

`AgentConnection.credentialCiphertext/Iv/AuthTag` — AES-256-GCM
(`lib/connectors/crypto.ts`), key derived from `AUTH_SECRET` via `scrypt`
rather than requiring a second secret just for this. Unlike `ApiKey`
(one-way hash — Aegis never needs the raw value back), a connector has to
present the original credential to the provider on every health check and
reconnect, so this has to be reversible. Never sent to the browser after
the initial connect request; `externalAccountLabel` (e.g. `sk-...ab12`) is
the only display-safe trace of it.

## Connect flow

1. `discoverConnectionAction` (read-only) — verifies the credential and
   runs discovery. Persists nothing, so the UI can call it freely while
   the user edits the field.
2. `connectAgentAction` — re-verifies everything from scratch (never
   trusts step 1's result) and, in one transaction: creates the `Agent`,
   creates the `AgentConnection` (encrypting the credential if any), and
   — for `CUSTOM_SDK` — auto-provisions a dedicated `ApiKey` so the user
   never has to visit Developers > API Keys separately.

If discovery finds more than one agent, `connectAgentAction` returns
`{ ok: false, needsSelection: true, agents }` instead of erroring — the
wizard (`components/agents/connect-agent-wizard.tsx`) shows a picker and
calls it again with `selectedExternalId`.

## Health, reconnect, disconnect

No background job infrastructure exists in this environment (same
constraint as `lib/webhooks/dispatch.ts`), so there is no scheduled health
polling — `checkConnectionHealth` runs only on demand (the agent page's
"Check connection" button). A failed check sets `RECONNECT_REQUIRED` and
records `lastHealthError`; it never silently stays `CONNECTED`.

`reconnectAgentConnection` re-verifies a fresh credential for
`OPENAI`/`ANTHROPIC` (and confirms it still owns the originally-connected
resource, when there is one) or rotates the `ApiKey` for `CUSTOM_SDK`
(revoking the old one) — there's no third-party credential to re-enter
there.

`disconnectAgentConnection` sets `status: DISCONNECTED`, clears the stored
credential, and revokes the connection's own `ApiKey` if it has one. It
never deletes the `Agent` or its `ActivityEvent` history. Ingestion is
gated on this: `POST /api/v1/events` and `/api/v1/evaluate` reject with
`AGENT_CONNECTION_DISCONNECTED` (409) for a disconnected agent's slug — see
`lib/agents/queries.ts#getAgentBySlugForIngestion`. An agent with no
`AgentConnection` row at all (created by the pre-existing manual flow,
before this feature) is never blocked.

## What this doesn't do

- No usage/cost sync from OpenAI or Anthropic — their usage/cost APIs
  require a separate admin-level credential this connection doesn't
  collect. `usageMonitoring`/`costMonitoring` stay `false` until that's
  built for real.
- No enforcement — `pauseAgent`/`killSwitch` stay `false` for every
  connector; see `lib/enforcement/` for why the in-app kill switch is a
  recorded intent, not an enforced one.
- No scheduled/background health polling — on-demand only (see above).
