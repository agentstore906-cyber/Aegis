# Connect Agent — the customer flow

Principle: **simple for the customer, sophisticated underneath.** Technical detail, evidence and the exact
mechanisms are in `AEGIS_CONNECT_AGENT_AUDIT.md`.

## What the customer does

1. **Connect your AI agent** (`/agents/new`, or "+ Connect Agent" on the home page / agent list).
2. **Agent name** → Continue. (Environment lives under "Advanced options"; OpenAI/Anthropic provider
   connections live under "Advanced connection options". No method picker, no IDs.)
3. **Your agent is ready.** One **Copy setup** button copies a ready-to-run snippet containing this agent's
   credential (shown once, stored only as a hash). The page says "Waiting for your agent…".
4. The customer runs the snippet in their agent. Nothing to install (plain HTTP); the SDK is optional/early access.
5. The page flips on its own to **Agent connected — Connected just now → View agent**. "Monitoring is active"
   appears only once a real event has arrived.
6. **Your agents** lists every agent with its real state (Waiting / Connected / Disconnected / Revoked / Error).
   "+ Connect another agent" repeats the flow; each agent gets its own identity, credential, activity and status.

## What Aegis does underneath

- Creates the agent, a `CONNECTING` connection and an **agent-bound credential** in one transaction.
- The credential — never the request body — decides organization and agent. A sent `agent` is only a claim and
  must match; sibling-agent and other-organization access is refused.
- "Connected" is **derived from evidence**: a request authenticated with that agent's own credential
  (`POST /api/v1/connect/handshake`, or its first event). Clicking Continue, opening the page, or an organization-wide
  key never marks anything connected. `lastSeenAt` moves only on real agent requests (written at most once a minute).
- The handshake is idempotent and doubles as a heartbeat. Events are deduplicated by `Idempotency-Key` and `clientEventId`.
- Events feed activity, behavior, trust and risk for that agent and organization only.
- Disconnect revokes the credential (history is kept); Reconnect keeps the same agent, issues a new credential and
  stays Waiting until the agent really makes contact; revoked/expired/invalid credentials are rejected with 401.

## What "protected" does and does not mean

Aegis is not in the agent's data path. A `BLOCK` decision is **recorded and returned**; it stops a tool call only when
the agent runs it through the SDK `guard()` (fails closed) or otherwise honours the decision. The UI therefore says
"Asks Aegis" / "Monitoring only" and never "Protected". There is no gateway. A new agent with no allow rule is
denied by default; the connected screen says so and links to policies.

## Known limits

No request signing (a stolen key works until revoked); no socket-level liveness (Connected = contacted recently);
`@aegis/agent-sdk` is not on a public registry; developer quickstart and public SDK docs still say `npm install`.
