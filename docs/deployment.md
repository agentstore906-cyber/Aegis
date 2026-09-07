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

**Optional — billing (Paddle Billing).** The app runs fully without these;
`/settings/billing` shows "not configured" and every org stays on Free.
See [§6](#6-paddle-webhook-configuration).

| Variable | Purpose |
|---|---|
| `PADDLE_API_KEY` | Server-side API key (Developer tools → Authentication) — never sent to the client |
| `PADDLE_CLIENT_TOKEN` | Publishable client-side token (same page) — safe to expose to a browser by Paddle's own design; required to open the Paddle.js checkout overlay (served to the browser via `GET /api/billing/config`, never `PADDLE_API_KEY`) |
| `PADDLE_WEBHOOK_SECRET` | Verifies `POST /api/webhooks/paddle` signatures (the secret shown when creating the notification destination) |
| `PADDLE_ENVIRONMENT` | `sandbox` or `production` — selects which Paddle API/dashboard the server SDK talks to |
| `PADDLE_STARTUP_PRODUCT_ID` / `PADDLE_STARTUP_PRICE_ID` | Startup plan's Paddle product + price id (Catalog → Products) |
| `PADDLE_GROWTH_PRODUCT_ID` / `PADDLE_GROWTH_PRICE_ID` | Growth plan's Paddle product + price id |
| `PADDLE_BUSINESS_PRODUCT_ID` / `PADDLE_BUSINESS_PRICE_ID` | Business plan's Paddle product + price id |

Only the price id is used in any API call (checkout only needs a price);
the product id is kept alongside it in `lib/billing/plans.ts` purely so a
half-configured plan (price set, product not, or vice versa) is easy to
spot when reading the config. There is no Enterprise price — that plan is
"Contact sales" only, deliberately never wired to a Paddle checkout.

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

## 6. Paddle webhook configuration

If billing is enabled (§2), create a notification destination in **Paddle
→ Developer tools → Notifications** pointing at:

```
https://<your-domain>/api/webhooks/paddle
```

Copy its signing secret into `PADDLE_WEBHOOK_SECRET`. Subscribe it to at
least: `subscription.created`, `subscription.updated`,
`subscription.canceled`, `transaction.completed`,
`transaction.payment_failed`. Other event types are safely ignored (the
endpoint acknowledges them with 200 so Paddle doesn't retry them forever).

The endpoint verifies the `Paddle-Signature` header via the official
`@paddle/paddle-node-sdk`'s `webhooks.unmarshal` (HMAC-SHA256 of
`timestamp:rawBody`, constant-time compared, with a replay-window check)
before touching the database (`app/api/webhooks/paddle/route.ts`). Paddle
notifications carry a stable `event_id`, so replays are deduplicated
directly on that id (`BillingWebhookEvent` table);
handling is also written to set absolute state (never deltas), so an
out-of-order or duplicated event still converges. **Verified with
signature-verification, idempotency, tenant-isolation and lifecycle tests
using synthetic events (`app/api/webhooks/paddle/__tests__/route.test.ts`),
not against a live Paddle account.** Run one real checkout → webhook →
plan-change round trip against a Paddle **sandbox** account before relying
on it in production.

### Switching from sandbox to production

1. Create the live product + prices in **Paddle → Catalog → Products**
   (sandbox and production are entirely separate Paddle accounts/catalogs —
   there's no "publish" step between them). Copy the live product/price ids
   into `PADDLE_*_PRODUCT_ID` / `PADDLE_*_PRICE_ID`.
2. Generate a **live** API key and client token (Developer tools →
   Authentication) → `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`.
3. Create a **live** notification destination at the same
   `/api/webhooks/paddle` URL with a fresh signing secret →
   `PADDLE_WEBHOOK_SECRET`.
4. Set `PADDLE_ENVIRONMENT="production"`.
5. Redeploy. No code or schema change is required — every Paddle value is
   read from the environment.

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
