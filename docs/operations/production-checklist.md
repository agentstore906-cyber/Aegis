# Production checklist

Status as of this Phase 9 pass. Checked items are verified against the
actual code/tests referenced, not assumed. Unchecked items require
deployment-time configuration this repo can't do on its own behalf.

## Database

- [ ] `DATABASE_URL` configured for the target environment — deployment-time.
- [x] Migrations verified — `npx prisma validate` passes; `prisma migrate
      deploy` is the documented production command (`docs/deployment.md` §3).
- [ ] Backups configured — **not implemented in-app, provider-dependent**;
      see `docs/operations/backups.md`. Must be confirmed per deployment.
- [x] Connection handling verified — `lib/db.ts` uses the Prisma 7
      `@prisma/adapter-pg` pattern (no deprecated `datasource` URL config);
      single pooled `PrismaClient` per process.

## Security

- [ ] Secrets configured (`AUTH_SECRET`, `DATABASE_URL`, `LEMONSQUEEZY_*`
      if billing is enabled, `PLATFORM_ADMIN_EMAILS` if `/admin` is needed) —
      deployment-time, see `docs/operations/environment.md`.
- [x] Authentication verified — bcrypt (cost 12) password hashing, JWT
      sessions with explicit `maxAge`/cookie config (`lib/auth/index.ts`),
      credentials-provider input validated via Zod.
- [x] Sign-in/sign-up rate limiting — per-IP throttles in
      `lib/auth/actions.ts` (Phase 9 addition; see the codebase's own
      documented in-memory/multi-instance caveat).
- [x] RBAC verified — centralized `hasCapability()`
      (`lib/rbac/capabilities.ts`), tested in
      `lib/rbac/__tests__/capabilities.test.ts`.
- [x] Tenant isolation tested — `requireActiveOrganization()` /
      `withApiAuth()` used consistently; covered by integration tests across
      `lib/approvals`, `lib/security`, `lib/policies`, `app/api/v1`.
- [x] API keys secure — hash-only storage, revocation/expiry/scope enforced
      centrally in `withApiAuth` (`lib/api/handler.ts`), never logged raw.
- [x] Webhooks verified — inbound Lemon Squeezy `X-Signature`-verified +
      idempotent + tenant-scoped; outbound HMAC-signed + SSRF-checked. See
      `app/api/webhooks/lemonsqueezy/__tests__/route.test.ts` and
      `lib/webhooks/__tests__/`.
- [x] Rate limiting configured — public API (`lib/api/handler.ts`), lead
      form (`lib/leads/service.ts`), and now sign-in/sign-up. **Known
      limitation**: in-memory, not multi-instance-safe — see
      `lib/rate-limit/limiter.ts`'s own doc comment. Acceptable for a
      single-instance deployment; needs a Redis-backed implementation before
      running multiple instances behind a load balancer.

## Application

- [ ] `npm run build` passes — run at deploy time; see
      `docs/operations/release-process.md`.
- [ ] `npx tsc --noEmit` passes — run at deploy time.
- [ ] `npm test` passes — requires a reachable Postgres (integration tests
      use a real DB, not mocks — see `docs/security/questionnaire.md`'s
      Data isolation section for why).
- [x] Health check works — `GET /api/health`, DB-connectivity check only,
      no sensitive info exposed (`docs/deployment.md` §10).

## Billing

- [ ] Lemon Squeezy configured (if self-serve billing is enabled) —
      deployment-time; app runs fully without it (`docs/deployment.md` §2).
- [x] Webhooks verified — signature + idempotency + tenant isolation +
      lifecycle mapping tested against synthetic events (`docs/deployment.md`
      §6 explicitly notes this hasn't been verified against a live Lemon
      Squeezy store — do that before relying on it).
- [x] Entitlements verified — plan limits enforced server-side
      (`lib/billing/entitlements.ts`), checkout price always resolved
      server-side from a fixed plan allowlist, never client-supplied
      (`lib/billing/actions.ts`, pinned by
      `lib/billing/__tests__/plans.test.ts`'s "PLANS as a checkout allowlist"
      tests).

## Observability

- [x] Logs — structured per-request logging on the public API
      (`lib/api/logger.ts`), never logs raw API keys.
- [ ] Monitoring/error tracking/alerting — **not configured in this repo**;
      whatever your deployment platform provides for stdout log capture is
      what exists today. No APM/error-tracking SDK is wired in.
- [x] Security alerts — in-app detectors with dedup (`lib/security/`), not
      external paging.

## Documentation (this pass)

- [x] `docs/operations/{backups,rollback,disaster-recovery,
      release-process,production-checklist,environment}.md`
- [x] `docs/security/{incident-response,security-incident-checklist,
      architecture}.md`

See the final report in this pass's conversation for the full list of what
was verified vs. genuinely out of scope.
