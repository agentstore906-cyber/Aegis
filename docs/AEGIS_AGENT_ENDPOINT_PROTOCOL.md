# aegis-agent/1 — how Aegis connects to a real external agent

## Why this exists (audit)
Before this change Aegis had exactly three ways to "connect" an agent, none of which was Aegis reaching an arbitrary external agent:
- **OPENAI / ANTHROPIC**: verify a provider API key against the provider (OpenAI can list Assistants). That proves a provider account, not an agent endpoint.
- **CUSTOM_SDK**: Aegis creates a record and a credential and *waits* for the agent to call Aegis.
- Nothing else. A generic AI agent exposes no interface Aegis could call.

So the smallest concrete interface that makes "Aegis connects to the agent" real is: **the agent exposes one HTTPS endpoint that answers a signed challenge.** Nothing else is assumed about the agent (language, framework, model).

## The protocol
Aegis → agent: `POST <endpoint URL>`

```
x-aegis-protocol:  aegis-agent/1
x-aegis-timestamp: <epoch milliseconds>
x-aegis-signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + exact request body)>
content-type:      application/json

{ "protocol": "aegis-agent/1", "op": "verify" | "describe", "challenge": "<32 random bytes, base64url>" }
```

The agent MUST refuse (HTTP 401) any request whose signature is missing or wrong, or whose timestamp is more than five minutes from its clock. Otherwise it answers 200 JSON:

```
{ "protocol": "aegis-agent/1",
  "agent": { "id": "<stable id>", "name": "<display name>" },
  "proof": "<hex HMAC-SHA256(secret, 'aegis-agent/1:' + op + ':' + challenge + ':' + agent.id + ':' + manifestDigest)>",
  "manifest": { ... }          // describe only
}
```
`manifestDigest` is `sha256(JSON.stringify(manifest))` for `describe`, and the empty string for `verify`.
`manifest` (optional, `describe`): `{ framework?, model?, tools?: [{ name, access?: "read"|"write"|"destructive" }], humanApproval?: boolean }`.

`verify` has no side effect. `describe` only returns the manifest. **Neither executes a tool or accepts any content.** A complete dependency-free implementation is `scripts/e2e/real-external-agent.mjs`.

### What a successful verification proves
- something reachable answered at that URL and speaks this protocol (not just any web server);
- it holds the shared secret the owner configured (only then can it compute the proof) — the agent is the one the owner meant;
- the answer is live: the challenge is fresh per request, so a recorded answer cannot be replayed;
- the agent's own id, which Aegis then **pins**. A later verification that answers with another id is a different agent and is refused.

It does **not** prove anything about the agent's prompts, code or model. The manifest is the agent's own declaration, covered by the proof (so it can't be altered in transit) but only as truthful as the agent.

## Connection flow
1. Connect Agent asks for the endpoint URL and the shared secret (and optionally a display name).
2. Aegis validates the URL (HTTPS, public address, no credentials, no query), then makes the signed `verify` request.
3. Only if the proof is valid does anything get created: the Agent, an `AgentConnection` (`AEGIS_ENDPOINT`, `CONNECTED`, endpoint URL, pinned agent id, encrypted secret), an audit event. A failure (unreachable, timeout, TLS error, redirect, rejected signature, not an aegis-agent/1 endpoint, bad proof, private address) shows the reason and creates **nothing**.
4. The same endpoint, or the same agent id through another URL, cannot be connected twice in an organization.

## Free Risk Scanner
Only agents connected this way are offered. A scan re-verifies the agent live (fresh challenge; it must still be the pinned agent), reads the manifest, sends three read-only refusal probes to the endpoint (no signature, wrong signature, a validly signed request an hour old — a correct agent refuses all three), reads what Aegis recorded about the agent, and asks Aegis's own policies how they would answer sensitive requests (read-only simulation). It never runs a tool or sends the agent content. Anything it could not check is returned as **not tested** with the reason.

## Security notes
- **SSRF**: Aegis is making a request to an address a customer typed. https only; the host must resolve to public addresses only (no loopback, private, link-local, CGNAT, multicast, reserved); the validated address is the address connected to (DNS answers are not re-resolved); TLS is verified against the original host name; redirects are never followed; response ≤ 64 KB, 8 s, must be JSON. Self-hosters whose agents are on a private network opt in with `AEGIS_ALLOW_PRIVATE_AGENT_ENDPOINTS=true` (never honoured when `VERCEL_ENV=production`); that also permits plain HTTP.
- **Secret**: entered once, used to sign, stored encrypted with the existing credential keyring, never returned to the browser, never sent on the wire (only HMACs are).
- **Identity** is the agent-declared id proven with the secret, pinned per connection, unique per organization — never a name or slug. The caller never names an agent; the organization comes from the session.
- Existing SDK / handshake / API-key identity is unchanged.

## Database
Migration `20261014120000_aegis_endpoint_connections` (additive): enum `ConnectorType` + `AEGIS_ENDPOINT`; `agent_connections.endpointUrl` with a unique index on `(organizationId, endpointUrl)`; `agent_security_scans.endpointTests` and `.notTested` (JSONB, default `[]`). Together with `20261013120000_agent_security_scans` (also not yet deployed).
