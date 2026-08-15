# Customer security questionnaire — prepared answers

Factual answers to the questions that come up in a security review, drawn
directly from the code and the docs it's based on. Where something is
genuinely unknown or deployment-dependent, it's marked as such — never
guessed. See also `/trust` (the public-facing version of this) and
`docs/security-intelligence.md`, `docs/rbac.md`, `docs/webhooks.md`,
`docs/deployment.md`.

## Data isolation

Multi-tenant. Every tenant-owned row (`Agent`, `ActivityEvent`,
`OrganizationMember`, policies, approvals, audit events, API keys, etc.)
carries an `organizationId`. `lib/organizations/queries.ts` is the single
place that resolves which organization the current request may see —
always from the authenticated session's real memberships, never from a
client-supplied ID. Covered by dedicated tenant-isolation integration
tests (real Postgres, not mocked).

## Authentication

Email + password (Auth.js/NextAuth v5, credentials provider), passwords
hashed with bcrypt (12 rounds), JWT sessions. OAuth provider schema exists
but no OAuth provider is wired up yet. External agent processes
authenticate separately, via API key (see below) — not user sessions.

## Authorization

Central `hasCapability(role, capability)` map
(`lib/rbac/capabilities.ts`) — six roles (Owner, Admin, Engineer,
Security, Finance, Viewer), no scattered per-route role checks. Full
capability table in `docs/rbac.md`. Privilege escalation is structurally
prevented: only an existing Owner can grant/revoke Owner, and an
organization can never be left with zero Owners (enforced inside the same
transaction as the mutation, not just in the UI).

## Encryption

TLS in transit, assuming standard deployment behind HTTPS (enforced via
HSTS in production — see `next.config.ts`). At-rest encryption is
whatever your Postgres provider offers — this repo doesn't implement its
own encryption-at-rest layer; **requires deployment/customer
configuration** to confirm for a specific hosting provider.

## Secrets handling

- API keys: SHA-256-hashed at rest, never stored or logged raw, shown
  once at creation, revocable, optional expiration. A fast hash is
  intentional here (not bcrypt) — see `docs/api.md` for the reasoning
  (high-throughput lookup path, not a low-entropy user password).
- Webhook secrets: random per-endpoint, shown once, HMAC-SHA256-signs
  every delivery; structurally excluded from list-view queries (an
  explicit Prisma `select`, not just UI omission).
- Caller-supplied JSON (event metadata, policy context) is passed through
  `redactSecrets()` at every persistence point that stores it, masking
  credential-shaped keys.

## Logging

Structured per-request logging for the public API — never logs the raw
API key. Application logs are otherwise whatever your deployment platform
captures from stdout; **requires deployment/customer configuration** for
log retention/shipping specifics.

## Audit

Append-only `AuditEvent` trail covering every policy/permission/agent
mutation and every approval state transition, filterable at `/audit`. No
row is ever updated or deleted by application code once written.

## API keys

Organization-scoped (act as the organization, never as a user), created
and revoked from `/developers/api-keys`, rate-limited (60 req/min per
key — in-process limiter today, not yet multi-instance-safe, see
`docs/deployment.md`), support an `Idempotency-Key` header for safe retry
of mutating requests. Scopes exist in schema and are checked per-endpoint,
but there's no scope-picker UI yet — every key is created with the full
default scope set (see `docs/api.md#scopes`).

## Data retention

Per-data-type retention day-counts are configurable in
`/settings/organization`, but **nothing currently deletes data on a
schedule** — there's no background-job/scheduler infrastructure in this
environment. This is a known, explicitly documented gap, not an oversight
— see `docs/retention.md`. If a customer requires enforced retention,
that requires deployment-side scheduler infrastructure to be added.

## Backups

Entirely deployment-dependent — this repo doesn't implement its own
backup mechanism. Relies on your Postgres provider's backup/PITR feature.
**Requires deployment/customer configuration** to confirm the specific
provider's backup plan and retention window.

## Incident response

A documented process exists: `docs/security/incident-response.md` (detection
through post-incident review) and its actionable companion,
`docs/security/security-incident-checklist.md`. It's scoped honestly —
report-driven detection, manual containment/notification, no dedicated
on-call rotation or contractual SLA. See `/trust` (responsible disclosure)
for how a security report reaches the team. **Requires deployment/customer
configuration** for anything beyond what's documented (a real on-call
rotation, a contractual response-time SLA, a status page) — don't claim
those exist until they do.

## Deployment

Standard Next.js 16 app + PostgreSQL, no assumed hosting provider. Startup
environment validation fails fast on missing required config
(`lib/env.ts`). Security headers (CSP, HSTS in production, frame
protection) are set in `next.config.ts`. `GET /api/health` exposes only a
DB-connectivity boolean — no hostnames, connection strings, or version
info. Full deployment steps in `docs/deployment.md`.

## SSO

Schema-only placeholder (`Organization.ssoEnabled` / `.ssoProvider`) plus
a "not yet available" settings card — **no real SAML/OIDC integration
exists today**. Say this plainly if asked; don't imply it's further along
than it is.
