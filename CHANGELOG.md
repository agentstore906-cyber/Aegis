# Changelog

Meaningful, real changes by phase — derived from the actual commit history
and the phase-by-phase build log in `README.md`, not invented release
notes. No internal security-finding detail is included per Phase 9's own
documentation discipline (see `docs/security/incident-response.md`); a
security fix is noted as "hardened," not described in exploit detail.

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
