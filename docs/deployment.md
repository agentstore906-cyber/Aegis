# Deployment (Phase 6)

This repo doesn't assume a specific hosting provider — it's a standard
Next.js 16 app with a Postgres database. This document covers what's
actually required to run it in production; it doesn't invent
infrastructure (a scheduler, a Redis cluster, a CI pipeline) that doesn't
exist here. Where something is a known gap rather than "done," it's
called out explicitly rather than implied.

## 1. Database

PostgreSQL. Any managed Postgres works (Neon, Supabase, RDS, Railway,
etc.) — the app only needs a `DATABASE_URL` connection string. See
`README.md`'s "Local setup" for local options; production just needs a
real, backed-up instance (see [§10](#10-backups)).

## 2. Environment variables

Validated at boot by `lib/env.ts` — a missing required variable fails
immediately with a clear message instead of a deep Prisma/NextAuth error
later. Copy `.env.example` and fill in real values (never commit them).

**Required:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Signs session JWTs — `openssl rand -base64 32` |
| `AUTH_URL` | Public base URL of the deployment (e.g. `https://app.example.com`) — required in production, auto-detected in dev |

**Optional — billing (Stripe).** The app runs fully without these;
`/settings/billing` shows "not configured" and every org stays on Free.
See [§6](#6-stripe-webhook-configuration).

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/webhooks/stripe` signatures |
| `STRIPE_PRICE_STARTUP` / `STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_BUSINESS` | Stripe Price IDs for each self-serve plan — see `lib/billing/plans.ts` |

**Optional — future OAuth.** Not required; credentials (email+password)
auth works standalone. See `.env.example`.

## 3. Prisma migration

Use `prisma migrate deploy`, not `prisma migrate dev` — `dev` can prompt
interactively and is meant for local iteration; `deploy` applies pending
migrations non-interactively and is what CI/production should run:

```bash
npx prisma migrate deploy
npx prisma generate
```

Review new migrations before deploying them (`prisma/migrations/`) —
never run a destructive migration or `prisma db push --force-reset`
against production. See `README.md`'s note on WSL-specific local
Postgres quirks if developing on Windows; that quirk is local-only and
doesn't apply to a real deployment.

## 4. Build

```bash
npm run build
```

Runs `next build`. This also type-checks and lints as part of Next's
build (or run them explicitly first — see §65 of the Phase 6 checklist:
`npx tsc --noEmit && npm run lint`). Also build the SDK package if you're
publishing it or linking it into an agent process's own build:

```bash
npm run build:sdk
```

## 5. Start

```bash
npm run start
```

Runs `next start`, serving the build produced by `npm run build`. Set
`NODE_ENV=production` (most platforms do this automatically) — this also
enables `Strict-Transport-Security` in the security headers (see
`next.config.ts`) and disables the local-only HTTP carve-out in
`lib/webhooks/ssrf.ts`'s webhook-URL validator.

## 6. Stripe webhook configuration

If billing is enabled (§2), register a webhook endpoint in the Stripe
Dashboard (or via the Stripe CLI for local testing) pointing at:

```
https://<your-domain>/api/webhooks/stripe
```

Subscribe it to at least: `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
Copy the signing secret Stripe gives you into `STRIPE_WEBHOOK_SECRET`.
The endpoint verifies every request's signature before touching the
database (`app/api/webhooks/stripe/route.ts`) and is idempotent per
Stripe event id (`StripeWebhookEvent` table) — a redelivered event is a
safe no-op. **This has been verified with signature-verification and
idempotency tests using synthetic events (`app/api/webhooks/stripe/__tests__/route.test.ts`),
not against a live Stripe account** — this environment has no real Stripe
test-mode credentials. Test the full checkout → webhook → entitlement
round trip against a real Stripe test-mode account before relying on it
in production.

## 7. API base URL

External agent processes talk to `https://<your-domain>/api/v1/*` — see
`docs/api.md`. There's no separate API host; it's the same deployment.

## 8. SDK configuration

`@aegis/agent-sdk` needs `baseUrl` (this deployment's URL) and an API key
created from `/developers/api-keys`. See `docs/api.md` and
`packages/agent-sdk/README.md`. Never ship an API key to a browser bundle
— the SDK is for server-side agent processes only.

## 9. Background jobs / scheduled tasks

**None exist in this codebase, and none run automatically in any
deployment of it.** This is a real, current limitation, not an oversight:

- **Retention** (`Organization.activityRetentionDays` etc.) is
  configuration only — nothing deletes data on a schedule. See
  `docs/retention.md`.
- **Webhook delivery** (Aegis → customer endpoints) is immediate,
  best-effort, with a couple of bounded inline retries — not a durable
  queue. See `docs/webhooks.md`.
- **Security cost-anomaly detection** runs inline, synchronously, as part
  of request handling (`lib/security/evaluate.ts`) — not on a schedule.

If you need any of the above to run on a schedule, that requires adding
real scheduler infrastructure (a cron trigger calling an internal
endpoint, a queue worker, etc.) — this document deliberately doesn't
pretend one exists.

## 10. Health checks

`GET /api/health` — checks DB connectivity, returns `{"status":"ok"}` /
200 or `{"status":"unavailable"}` / 503. Never reveals hostnames,
connection strings, or version numbers. Point your load balancer's/
orchestrator's health check at this path. There's no separate
liveness/readiness split — a single Postgres round-trip covers both for
an app this shape (no long-running background workers to check
separately).

## Backups

**Database backup strategy is entirely deployment-dependent** — this
repo doesn't implement one. Use your Postgres provider's backup/PITR
feature (most managed providers, e.g. Neon/Supabase/RDS, include this).
Don't assume backups exist just because a managed database is in use —
confirm your provider's specific backup plan and retention window.
