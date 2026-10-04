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
| `AUTH_SECRET` | Signs session JWTs — `openssl rand -base64 32`. Also the *fallback* key for encrypting stored provider credentials when `CONNECTOR_ENCRYPTION_KEYS` isn't set. If you rotate it, put the old value in `AUTH_SECRET_PREVIOUS` (see below) or existing OpenAI/Anthropic connections can't decrypt their stored key. |
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

**Recommended — credential encryption keyring (P0, `lib/connectors/credential-keyring.ts`).**

| Variable | Purpose |
|---|---|
| `CONNECTOR_ENCRYPTION_KEYS` | `id:base64key[,id:base64key…]` — dedicated AES-256 keys (32 bytes each, `openssl rand -base64 32`) for stored provider credentials. The first is the primary for new encryptions; others stay decrypt-only. Decouples credential encryption from `AUTH_SECRET`. |
| `AUTH_SECRET_PREVIOUS` | Comma-separated former `AUTH_SECRET` values, decrypt-only — set when rotating `AUTH_SECRET` so existing credentials keep working. |

Rotation: add the new key first in `CONNECTOR_ENCRYPTION_KEYS` (keep the
old one after it, and/or the old secret in `AUTH_SECRET_PREVIOUS`), deploy,
run `npx tsx scripts/rotate-connector-credentials.ts` (dry run) then
`--apply`, and remove the old key only once it reports nothing left on it.
Credentials are also re-encrypted lazily as connections are used.

**Recommended — telemetry pseudonym key (P1).** `TELEMETRY_HASH_KEY`
(base64, ≥32 bytes, `openssl rand -base64 32`) keys the HMAC that turns an
agent-reported `endUserId` into a stored pseudonym. Unset → derived from
`AUTH_SECRET`, which means rotating `AUTH_SECRET` changes every pseudonym
(continuity loss for per-user history, never an exposure). Set it once and
keep it stable.

**Optional — platform-wide risk-control stop (P5).** `AEGIS_RISK_CONTROL_DISABLED=1` (or `true`/`yes`) forces every organization to OBSERVE: risk is still assessed and recorded, but never changes a decision. Unset by default. It deletes nothing and each decision records both the configured and the effective mode. See `docs/AEGIS_P5_CONTROL.md`.

**Optional — scheduled behavior refresh (P2).** `CRON_SECRET` protects
`GET /api/internal/behavior/refresh`, which `vercel.json` schedules daily
(00:15 UTC; Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
automatically). Unset → the endpoint returns 503 and the cron is a no-op;
baselines are still computed lazily on first use each day. The same cron
also re-evaluates agent trust (P3), so trust recovers as evidence ages even
for agents that stay quiet; reads re-evaluate when stale as well.

**Optional — rate limiting (P0).** `RATE_LIMIT_BACKEND` = `postgres`
(default in production: counters shared across instances in the
`rate_limit_buckets` table) or `memory` (default elsewhere).

**Development only — integration tests (P0).** `DATABASE_URL_TEST` must
point at a separate, disposable database whose name contains `test`
(non-local hosts also need `AEGIS_ALLOW_REMOTE_TEST_DB=<host>`). Without it,
integration tests are skipped — they never use `DATABASE_URL`. See
`lib/testing/test-db-guard.ts`. (`.env.example` is matched by `.gitignore`,
so these variables are documented here rather than there.)

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

**P0 migration (`20261001120000_p0_decision_correctness`).** Additive
columns/tables plus conservative backfills — see
`docs/AEGIS_P0_IMPLEMENTATION.md` "Migration". It also changes decision
behavior at deploy time (strict policy matching, kill switch, single-use
approvals, agent-bound SDK keys); read that document before deploying.

**P1 migration (`20261002120000_p1_agent_data_foundation`).** Additive
columns/enums/indexes, two foreign keys, deterministic backfills, and
**append-only triggers** on `activity_events`, `policy_evaluations`,
`audit_events`, `approval_decisions`, and `security_alert_occurrences`. After
it, an `UPDATE` that changes recorded evidence fails at the database level
(for every client — including ad-hoc SQL). Deletes still work. See
`docs/AEGIS_P1_DATA_FOUNDATION.md` "Migration".

**Caution:** `npm run build` runs `prisma migrate deploy` against whatever
`DATABASE_URL` is set. To verify a build locally, use `npx next build` with
`DATABASE_URL` pointed at a local database.

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
using synthetic events (`app/api/webhooks/paddle/__tests__/route.integration.test.ts`),
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

**One scheduled job exists (P2):** the daily behavioral-baseline
pre-computation (`vercel.json` → `/api/internal/behavior/refresh`, requires
`CRON_SECRET`). It is an optimization only — baselines are computed lazily
on first use each day without it. Everything below still has **no**
scheduler:

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
