# Disaster recovery

What actually happens today when a dependency Aegis relies on goes down, and
what recovering from each scenario looks like. Scoped to what this
single-region, single-Postgres-instance deployment shape can actually do —
this document doesn't invent multi-region failover or automated recovery
that isn't built.

## Guiding principle

Every scenario below follows the same rule the policy engine itself is built
on (`docs/policy-engine.md`: "**Default: fail closed**"): if a
dependency Aegis needs to make a safe decision is unavailable, the request
fails or is blocked/held for approval — it never silently proceeds as if the
dependency said yes.

## Database (Postgres) unavailable

**What happens:** Every request that touches the database fails.
`GET /api/health` returns `503 {"status":"unavailable"}` (checked via a real
DB round-trip, not cached). No requests silently succeed against stale data.

**Recovery:** Restore Postgres availability (provider-side incident, or
restore from backup per `docs/operations/backups.md` if data was lost, not
just unavailable). Nothing in the application needs to be restarted once the
database is reachable again — Prisma reconnects on the next query.

**Out of scope today:** No read replica, no automatic failover to a standby,
no request queueing/buffering during an outage.

## Lemon Squeezy unavailable

**What happens:** `isBillingConfigured()` (`lib/billing/lemonsqueezy.ts`)
degrades to "not configured" when the env vars are absent; a genuine Lemon
Squeezy *outage* (vs. not configured) means checkout and customer-portal
link creation fail, and webhook deliveries are delayed. Existing
subscriptions already reflected in `Organization.plan`/`subscriptionStatus`
(the local mirror of Lemon Squeezy's state — see `prisma/schema.prisma`'s
Billing section) are unaffected — Aegis enforces entitlements from that
local field, not a live API call on every request, so an outage doesn't
degrade existing customers' access.

**Recovery:** Nothing to do on Aegis's side beyond waiting for Lemon
Squeezy. Its webhooks retry on failure, and processing is idempotent (the
`billing_webhook_events` dedup ledger plus absolute-state writes in
`lib/billing/sync.ts`) — once it recovers, redelivered events apply safely.

## Authentication (NextAuth) issue

**What happens:** If the identity provider path itself is broken (e.g. a
bad `AUTH_SECRET` misconfiguration after a deploy), no one can sign in or
have their session verified — this fails closed by construction, not by
special-case code: an invalid/missing session means every
`requireUser()`/`requireActiveOrganization()` call redirects to sign-in
rather than proceeding.

**Recovery:** This is almost always a configuration issue introduced by a
deploy (wrong/rotated `AUTH_SECRET`, wrong `AUTH_URL`) — see
`docs/operations/rollback.md`. Rotating `AUTH_SECRET` invalidates all
existing JWT sessions (everyone is signed out) — expected, not a bug.

## Policy engine unavailable

There's no separate "policy engine service" to go down independently — policy
evaluation (`lib/policies/evaluate.ts`-family code) runs in-process as part
of the same request that needs a decision. If it throws, the request that
needed a decision fails rather than defaulting to `ALLOW`. See
`docs/policy-engine.md` for the full fail-closed evaluation algorithm
(no matching permission/policy → `BLOCK`, not `ALLOW`).

## External agent traffic (the public API)

If `app/api/v1/*` is unreachable (deploy in progress, DB down), agent
processes using `@aegis/agent-sdk` receive request failures — the SDK does
not cache or assume a prior decision still holds. Nothing on the agent side
is designed to fail open in Aegis's absence; that's a property of how each
agent integrates Aegis's decision into its own control flow, not something
this repo can enforce remotely.

## Explicitly out of scope for this deployment shape

- Multi-region failover, automated database failover/standby promotion.
- A durable queue for webhook delivery or agent events (both are
  synchronous/best-effort today — see `docs/webhooks.md` and
  `docs/deployment.md` §9).
- An incident communication/status-page system — see
  `docs/security/incident-response.md` for what does and doesn't exist there.
