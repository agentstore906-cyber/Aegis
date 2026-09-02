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

**Optional — platform admin.** Comma-separated allowlist of emails allowed
into `/admin` (internal-only, not an organization role — see
`lib/admin/authorization.ts`). Unset means nobody can reach it, not
"everyone can" — fails closed.

| Variable | Purpose |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Comma-separated emails allowed into `/admin` |

**Optional — billing (Lemon Squeezy).** The app runs fully without these;
`/settings/billing` shows "not configured" and every org stays on Free.
See [§6](#6-lemon-squeezy-webhook-configuration).

| Variable | Purpose |
|---|---|
| `LEMONSQUEEZY_API_KEY` | Server-side API key (Settings → API) |
| `LEMONSQUEEZY_STORE_ID` | Numeric store id (Settings → Stores) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Verifies `POST /api/webhooks/lemonsqueezy` signatures (the secret you set when creating the webhook) |
| `LEMONSQUEEZY_STARTUP_VARIANT_ID` / `LEMONSQUEEZY_GROWTH_VARIANT_ID` / `LEMONSQUEEZY_BUSINESS_VARIANT_ID` | Numeric **variant** id of each plan's product — see `lib/billing/plans.ts` |
| `NEXT_PUBLIC_APP_URL` | Public origin, used to build the post-checkout redirect URL (falls back to `AUTH_URL`) |

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

## 6. Lemon Squeezy webhook configuration

If billing is enabled (§2), create a webhook in **Lemon Squeezy →
Settings → Webhooks** pointing at:

```
https://<your-domain>/api/webhooks/lemonsqueezy
```

Set a signing secret and copy it into `LEMONSQUEEZY_WEBHOOK_SECRET`.
Subscribe it to the `subscription_*` events (at minimum
`subscription_created`, `subscription_updated`, `subscription_cancelled`,
`subscription_resumed`, `subscription_expired`, `subscription_paused`,
`subscription_unpaused`, `subscription_payment_failed`,
`subscription_payment_success`, `subscription_payment_recovered`).

The endpoint verifies the `X-Signature` HMAC-SHA256 before touching the
database (`app/api/webhooks/lemonsqueezy/route.ts`). Lemon Squeezy
payloads carry no event id, so replays are deduplicated on a digest of
(event name + subscription id + the resource's `updated_at`)
(`BillingWebhookEvent` table); handling is also written to set absolute
state, so an out-of-order or duplicated event still converges.
**Verified with signature-verification, idempotency, tenant-isolation and
lifecycle tests using synthetic events
(`app/api/webhooks/lemonsqueezy/__tests__/route.test.ts`), not against a
live Lemon Squeezy store.** Run one real checkout → webhook → plan-change
round trip against a Lemon Squeezy **test-mode** store before relying on
it in production.

### Switching from test mode to live

1. In Lemon Squeezy, toggle the store out of **Test mode**.
2. Create the live product + variants (or publish the test ones). Copy the
   live **variant** ids into `LEMONSQUEEZY_*_VARIANT_ID`.
3. Generate a **live** API key (Settings → API) → `LEMONSQUEEZY_API_KEY`.
4. Create a **live** webhook at the same `/api/webhooks/lemonsqueezy` URL
   with a fresh signing secret → `LEMONSQUEEZY_WEBHOOK_SECRET`.
5. Set `LEMONSQUEEZY_STORE_ID` to the same store (the id doesn't change
   between modes) and `NEXT_PUBLIC_APP_URL` to the production origin.
6. Redeploy. No code or schema change is required — every Lemon Squeezy
   value is read from the environment.

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
