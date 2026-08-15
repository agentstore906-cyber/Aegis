# Launch checklist

Honest state as of Phase 7. Checked items are verified by an automated
test, a manual check performed in this environment, or both — see the
note under each section. Unchecked items are real gaps, not oversights;
each has a reason.

## Product

- [x] Signup works
- [x] Login works
- [x] Organization creation works
- [x] Agent connection works (real agent registration + API key)
- [x] Activity works
- [x] Policies work
- [x] Approvals work
- [x] Security works
- [x] Costs work
- [x] Audit works

All ten are covered by the app's Vitest integration suite (real Postgres,
not mocked) and were exercised end-to-end by
`lib/__tests__/e2e-core-flow.integration.test.ts` (Phase 6): create org →
agent → policy → evaluate → REQUIRE_APPROVAL → approve → full audit
trail by trace id.

## Security

- [x] Tenant isolation — every query re-scoped server-side by
      `organizationId`; covered by dedicated isolation integration tests.
- [x] Authorization — central `hasCapability()` map, no scattered role
      checks; RBAC unit-tested.
- [x] API keys — SHA-256 hashed, never stored/logged raw, revocable,
      optional expiration.
- [x] Webhooks — HMAC-signed, SSRF-checked at creation and delivery.
- [x] Secrets — redacted at every persistence point that stores
      caller-supplied JSON (6 of 6, Phase 6).
- [x] Rate limits — 60 req/min per API key, enforced.
      **Known limitation**: in-process only, not multi-instance safe yet.

## Billing

- [x] Free plan — default, no configuration needed.
- [x] Paid plans — Startup/Growth/Business/Enterprise defined in
      `lib/billing/plans.ts`.
- [x] Entitlements — enforced server-side at every creation path, not
      just displayed.
- [ ] Stripe test mode — the integration is real, working code with
      signature-verification and idempotency tests using synthetic
      events, but **has not been exercised against a live Stripe
      test-mode account** — this environment has no Stripe credentials.
- [x] Webhooks — signature verification + idempotent handling for 6
      event types, tested with synthetic signed payloads.
- [x] Billing UI — `/settings/billing` shows real usage against real
      limits; shows an honest "not configured" state when Stripe isn't
      set up.

## Marketing

- [x] Landing page
- [x] Pricing (reads live from the same config billing enforces)
- [x] Demo (`/demo` — interactive, clearly labeled sample data)
- [x] Documentation (`/docs` + subpages)
- [x] Contact (`/contact` — real lead capture: validated, honeypot +
      rate-limited + per-email throttled, persisted to a `Lead` row, not
      just a mailto link)
- [x] Enterprise CTA (`/pricing`'s Enterprise plan routes to
      `/contact?source=enterprise`, not a generic "Contact us")
- [x] Responsible disclosure (`/trust`'s "Responsible disclosure" section
      — degrades honestly if `NEXT_PUBLIC_CONTACT_EMAIL` isn't set)

## Sales & GTM (Phase 8)

- [x] Lead dashboard (`/admin/leads` — platform-admin-only, gated by an
      env allowlist (`PLATFORM_ADMIN_EMAILS`), 404s for everyone else;
      list/filter/status-update)
- [x] Sales collateral (`docs/sales/*.md` — one-pager, demo script,
      objections, outreach templates, target-account template)
- [x] Customer research templates (`docs/customer-research/*.md`)
- [x] GTM playbook (`docs/gtm/*.md` — weekly loop, content strategy,
      founder-led sales, competitive-research structure)
- [x] Security questionnaire (`docs/security/questionnaire.md`)
- [ ] Real target accounts, real customer interviews, real feedback log
      entries — all templates above are deliberately unpopulated; see
      `docs/customer-feedback.md` and `AGENTS.md` §85

## Operations

- [ ] Production environment — not provisioned in this environment (no
      hosting account exists here to verify against).
- [x] Database — schema, migrations, and index review complete.
- [ ] Monitoring — no error-monitoring provider is wired up; would need
      a real account (Sentry or similar) to verify.
- [x] Logs — structured per-request logging for the public API; never
      logs the raw key.
- [x] Health checks — `GET /api/health`, checks DB connectivity.
- [x] Backups documented — `docs/deployment.md` is explicit that backup
      strategy is entirely deployment-provider-dependent; this repo
      doesn't implement one and doesn't claim to.
