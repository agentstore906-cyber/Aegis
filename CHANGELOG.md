# Changelog

Meaningful, real changes by phase — derived from the actual commit history
and the phase-by-phase build log in `README.md`, not invented release
notes. No internal security-finding detail is included per Phase 9's own
documentation discipline (see `docs/security/incident-response.md`); a
security fix is noted as "hardened," not described in exploit detail.

## Unreleased

- **Security hardening (sign-in throttling, outbound webhooks).** Sign-in throttling is now enforced where credentials are verified, so it also covers the Auth.js credentials route (previously only the sign-in form action); outbound webhook delivery now connects only to a validated public address, never follows redirects, and has a total deadline and response cap. IPv6 private-range detection was tightened.
- **Security hardening (client IP trust, webhook plan gate).** Rate limits no longer trust a raw client-supplied forwarding header: Vercel's platform header is used, other hosts declare `AEGIS_TRUSTED_PROXY_HOPS`, and otherwise no address is trusted. Outbound webhook delivery now re-checks the organization's current plan before every attempt and retry.
- **Rate-limit client IP follow-ups.** IPv4-mapped IPv6 addresses now share the plain IPv4 client's bucket instead of collapsing into one IPv6 /64; `ip:port` and `[ipv6]:port` forms from trusted headers are parsed; and when no trustworthy client IP exists, sign-in, sign-up and the lead form no longer share one global bucket (per-email limits apply instead, with a one-time `client_ip_untrusted` warning).
- **Pre-deployment hardening (local, nothing deployed, no migration).** Paddle `subscription.paused`, `.resumed` and
  `.past_due` are now handled (status-driven: paused drops to Free, resumed restores the plan, past_due keeps it) with
  the same signature, idempotency, ordering, replaced-subscription and fail-closed rules. First-time detectors (new
  sensitive action / new tool / new namespace) now also consult behavior rollups and earlier alerts
  (`lib/security/history.ts`), so a retention purge no longer makes old actions look new. The retention purge isolates
  failures per organization and reports `organizationsFailed` / `failures` (ids and error class only; HTTP 500 when any
  failed). Pricing cards no longer claim features with no backend difference (full/basic monitoring, security monitoring,
  cost analytics, team permissions, advanced RBAC, SSO-ready, advanced security); Growth no longer repeats Startup's
  policy conditions; outbound webhooks (enforced on Startup+) and audit log export (Growth+) are listed where granted.
- **Paused-subscription retention hold.** A paused subscription's history is held for up to 90 days from
  `planDowngradedAt` (a paused organization with no timestamp is skipped and counted separately); pausing → cancelled
  restamps the timestamp so the cancellation grace period still applies. No schema change; the purge is still unscheduled
  and deletion still off.
- **Paddle webhook hardening + retention safety.** A paid subscription whose price matches no configured plan no longer
  silently becomes Free: the plan is left untouched, the event fails (500, not recorded) so Paddle retries, and a repriced
  legacy subscriber keeps its plan (price ids are matched whitespace-insensitively, as checkout sends them). Recent
  subscription events that match no organization are retried instead of recorded as processed. Subscription events are
  applied in order under a per-organization row lock (stale and replaced-subscription events are ignored; stale payment
  events cannot override newer payment state). New nullable columns `billingEventAt`, `paymentEventAt`,
  `planDowngradedAt` (migration `20261015120000_billing_event_ordering`, additive). Retention now skips Free
  organizations with an active/trialing/past_due subscription and waits 14 days after a downgrade. The retention cron is
  intentionally not scheduled in `vercel.json` yet.
- **Free plan audit fixes.** Policy conditions ("advanced policies") are now actually gated to Startup+ in the
  policy repository (create, update, enable), with an upgrade message and a mirrored form state; plan-based activity
  retention purge code exists (`/api/internal/retention/purge`, dry-run by default; see `docs/retention.md`) but is NOT
  scheduled — `vercel.json` has no retention cron — so nothing is deleted until it is deliberately enabled, and the first
  delete run removes existing history older than each plan's window; agent counting is one definition
  (`lib/agents/quota.ts`) and retired agents are documented to still count toward the limit; the Connect Agent
  "Upgrade" link is shown only to roles that can open `/upgrade`; the signed-in Free Risk Scanner has a per-agent and
  per-workspace hourly fair-use limit (configurable); scanner and retention docs rewritten. No migrations.
- **Agent Arena removed.** The benchmark, scorecards, public `/a/[slug]` pages, `/arena` dashboard and nav entry are gone.
  Migration `20261012120000_remove_agent_arena` drops the four `arena_*` tables and the `ArenaScorecardStatus` enum
  (destructive). See `docs/AEGIS_AGENT_ARENA_REMOVAL.md`.
- **Billing provider switched from Lemon Squeezy to Paddle Billing.** New
  subscriptions open through Paddle's client-side checkout overlay
  (Paddle.js, initialized from the publishable `PADDLE_CLIENT_TOKEN` via
  `GET /api/billing/config`) rather than a server-redirect — Paddle
  Billing requires a dashboard-configured "default payment link" before a
  server-created Transaction will even return a checkout URL, so the
  overlay is what actually works without extra manual Paddle Dashboard
  setup and lets the return-to-app URL be set dynamically per checkout.
  The price id is still resolved server-side from `PLANS` in
  `createCheckoutSessionAction`, never trusted from the client; the
  browser only ever receives the one price/customer id that action
  resolved. Plus on-demand customer-portal sessions, subscription
  cancel/change-plan actions (server-to-server, no checkout UI needed),
  and a `Paddle-Signature`-verified, idempotent webhook at
  `/api/webhooks/paddle` (`lib/billing/paddle.ts`, `lib/billing/sync.ts`),
  built on the official `@paddle/paddle-node-sdk`. New
  `GET /api/billing/subscription` route for reading the caller's own
  subscription state. The CSP (`next.config.ts`) now allows Paddle's
  script, checkout-iframe, and API origins — the only third-party origin
  in the policy. Plan config, entitlements, authorization, and the
  `/settings/billing` page are otherwise unchanged in shape — only the
  provider under them, plus new "Cancel subscription" and "Switch plan"
  controls. The Lemon Squeezy client and route were removed. Migration
  `20260907130000_replace_lemonsqueezy_with_paddle` renames the three
  Lemon Squeezy id columns to their Paddle equivalents
  (`paddleCustomerId`, `paddleSubscriptionId`, `paddlePriceId`); no data
  is dropped. Unlike Lemon Squeezy, Paddle notifications carry a stable
  `event_id`, so webhook dedup no longer needs a synthetic digest.
- **Billing provider switched from Stripe to Lemon Squeezy.** Hosted
  checkout, on-demand customer-portal links, and an `X-Signature`
  HMAC-verified, idempotent webhook at `/api/webhooks/lemonsqueezy`
  (`lib/billing/lemonsqueezy.ts`, `lib/billing/sync.ts`). Plan config,
  entitlements, authorization, and the `/settings/billing` page are
  unchanged in shape — only the provider under them. The Stripe client,
  route, and `stripe` dependency were removed. Migration
  `20260901120000_replace_stripe_with_lemonsqueezy` drops the two
  Stripe id columns (always empty — no org ever completed a checkout),
  adds Lemon Squeezy id + period columns, and renames
  `stripe_webhook_events` → `billing_webhook_events`.
- Raised paid-plan agent limits (Startup 10→25, Growth 50→100,
  Business 200→500).

## Phase 10 — Customer-proven scale

- Added an auto-detected onboarding checklist on `/overview`
  (`lib/onboarding/status.ts`) — no manually-checked boxes, every step
  derived from real data.
- Added proactive plan-limit usage indicators on the agent-creation,
  API-key-creation, and member-invite flows, not just `/settings/billing`.
- Team invitations: added resend (regenerates the token), duplicate-pending-invite
  now reissues instead of creating a second live invitation, and
  invitation revoke/resend are now audited.
- Added a minimal in-app feedback/feature-request system: organization
  members submit and vote on requests at `/feedback`; platform staff
  triage status at `/admin/feedback`.
- Added an internal `/admin/metrics` view sourced entirely from real
  database aggregates (organizations, activation rate, agents, governed
  actions, MRR, plan distribution) — no sample data, no fabricated trend
  lines.
- Capped an unbounded agent-list query used for filter dropdowns.
- New documentation: `docs/product/roadmap.md`,
  `docs/customer-success/scorecard.md`,
  `docs/customer-research/phase-10-interview.md`, `docs/gtm/metrics.md`,
  this changelog.

## Phase 9 — Production hardening

- Added per-IP rate limiting to sign-in and sign-up (previously
  unmitigated against credential-stuffing/brute-force).
- Made session/cookie configuration explicit in code (`lib/auth/index.ts`)
  instead of relying on implicit framework defaults.
- Added a regression test pinning that a tampered/unrecognized plan id can
  never resolve to a real Stripe checkout price.
- New documentation: `docs/operations/{backups,rollback,disaster-recovery,
  release-process,production-checklist,environment}.md`,
  `docs/security/{incident-response,security-incident-checklist,
  architecture}.md`.
- Audited and confirmed (no change needed): tenant isolation, RBAC,
  API-key handling, webhook signature verification, billing
  authorization — all already correct.

## Phase 8 — Go-to-market infrastructure

- Real lead-capture flow at `/contact` (validated, honeypot- and
  rate-limited, persisted to a `Lead` model), with an Enterprise-specific
  CTA from `/pricing`.
- Platform-admin-only lead dashboard at `/admin/leads`.
- Responsible-disclosure section on `/trust`.
- Full sales/GTM documentation set (`docs/sales/`,
  `docs/customer-research/`, `docs/gtm/`, `docs/security/questionnaire.md`).

## Phase 7 — Launch readiness & customer validation

- SEO fundamentals, draft legal pages (`/privacy`, `/terms`), a public
  Trust & Security page, a public documentation hub (`/docs` and seven
  subpages), and expanded analytics event coverage for the activation
  funnel.

## Phase 6 — Billing & production hardening

- Real Stripe Checkout, customer portal, and signature-verified,
  idempotent webhook handling — gated behind Stripe being configured, with
  an honest "not configured" state otherwise.
- Server-side plan/entitlement enforcement (`lib/billing/entitlements.ts`)
  against agent/member/API-key creation, webhook creation, and audit
  export.
- Security headers, startup environment validation, `/api/health`,
  extended secret redaction, atomic audit-event writes.

## Phase 5 — Security, cost, and team features

- Behavioral security alerts, cost intelligence, expanded RBAC (`FINANCE`
  role), member management, teams, retention settings, outbound webhooks.

## Phase 4 — Public API & SDK

- Versioned public API, organization-scoped API keys, and
  `@aegis/agent-sdk` — a real external agent process can authenticate,
  report activity, and request a policy decision.

## Phase 3 — Approvals & audit

- Human approval workflow for `REQUIRE_APPROVAL` policy decisions, and an
  append-only audit trail.

## Phase 2 — Policy engine

- Agent permissions, conditional policies, the policy tester, and
  evaluation history.

## Phase 1 — Foundation

- Marketing site, authentication, multi-tenant organizations, and the
  Agents / Activity product surface.
