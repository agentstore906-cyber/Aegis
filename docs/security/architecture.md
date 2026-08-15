# Security architecture

A system-level entry point into how Aegis enforces security, consolidating
what's otherwise scattered across `docs/rbac.md`, `docs/policy-engine.md`,
and `docs/security-intelligence.md`. Read those for depth on each layer;
this page is the map.

## The request path

```
User                          Agent process (via @aegis/agent-sdk)
  |                                    |
  v                                    v
Authentication                   API key auth
(NextAuth, JWT session,          (lib/api-keys/service.ts,
 lib/auth/)                       hash lookup, revocation/
  |                                expiry/scope checked)
  v                                    |
Organization                          |
(requireActiveOrganization() —        |
 session's real memberships only,     |
 lib/organizations/queries.ts)        |
  |                                    |
  v                                    v
RBAC                              (API keys act as the
(hasCapability(role, cap),        organization, not a user —
 lib/rbac/capabilities.ts)        scopes gate what operation,
  |                                not who)
  v                                    |
  +---------------- Aegis API ---------+
                        |
                        v
                  Policy Engine
        (lib/policies/evaluate.ts — two layers:
         AgentPermission baseline + conditional Policy
         rules — fail-closed: no match => BLOCK)
                        |
                        v
                     Agent
                        |
                        v
                  Tool / Action
```

Every step down that path writes to one or more of the sinks below — no
action is "invisible" once it reaches the API.

## The sinks — every important action lands in these

- **Audit** (`AuditEvent`) — who/what did it, to what, when, result.
  Append-only from the application's perspective; nothing updates or
  deletes a row once written. See `docs/approvals-and-audit.md`.
- **Activity** (`ActivityEvent`) — the structured record of what an agent
  actually did (tool calls, model calls, data access), independent of
  whether a human was involved.
- **Security** (`SecurityAlert`) — behavioral detectors over `ActivityEvent`
  (unusual actions, risk spikes, cost anomalies), deduplicated per
  `(agentId, type)`. See `docs/security-intelligence.md`.
- **Cost** — derived from `ActivityEvent`'s cost/token fields, not a
  separate ingestion path. See `docs/cost-intelligence.md`.

## Layer-by-layer, with the file that owns each decision

| Layer | Owns the decision in | Fails closed by |
|---|---|---|
| Authentication | `lib/auth/index.ts`, `lib/auth/session.ts` | No valid session/JWT → treated as signed out, every protected route redirects. |
| Organization resolution | `lib/organizations/queries.ts` | A user's active org is only ever one of their *real* `OrganizationMember` rows — a cookie/slug alone never grants membership. |
| RBAC | `lib/rbac/capabilities.ts` | A role not explicitly granted a capability doesn't have it — no wildcard/default-allow. Privilege escalation to Owner is structurally blocked outside an existing Owner (`lib/organizations/members.ts`). |
| API key auth | `lib/api-keys/service.ts`, `lib/api/handler.ts` | Revoked/expired/unrecognized key → 401, checked on every request, not cached past validity. |
| Policy engine | `lib/policies/evaluate.ts` | No matching `AgentPermission` or `Policy` → `BLOCK`, not `ALLOW`. See `docs/policy-engine.md`'s full precedence rules. |
| Tenant isolation | Every `lib/*/repository.ts` | Every tenant-owned-model query/mutation is scoped by `organizationId` sourced from the authenticated session/API key — never from a client-supplied body/param. |

## Secrets

- **API keys**: SHA-256 hash only, raw shown once at creation. See
  `docs/api.md`.
- **Webhook secrets**: random per-endpoint, HMAC-SHA256-sign every outbound
  delivery. See `docs/webhooks.md`.
- **Passwords**: bcrypt, cost 12.
- **Caller-supplied JSON** (event metadata, policy context): passed through
  `redactSecrets()` (`lib/security/redact.ts`) at every persistence point.

## What's explicitly not built here

- SSO/SAML/OIDC (`Organization.ssoEnabled`/`.ssoProvider` are schema
  placeholders only).
- Multi-instance-safe (Redis-backed) rate limiting — current limiter is
  documented as in-memory/single-process, with a stated upgrade path.
- Scheduled data retention enforcement (`docs/retention.md`).
- Automated backup/CI/incident-response tooling — see
  `docs/operations/` and `docs/security/incident-response.md`.

None of the above are silently assumed elsewhere in this codebase's
documentation — each is called out at its own point of relevance as well.
