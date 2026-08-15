# Environment variables

`docs/deployment.md` §2 is the canonical walkthrough (what each variable
does, how it's used, what degrades gracefully without it). This page is a
short index — no values, ever — for quickly checking what a given
environment needs.

## Required (app fails to boot without these — `lib/env.ts`)

- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_URL` (production only — auto-detected in dev)

## Optional — degrades gracefully, feature-scoped

- `PLATFORM_ADMIN_EMAILS` — unset means `/admin` is unreachable by anyone,
  not open to everyone. Fails closed.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_STARTUP` / `STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_BUSINESS` —
  unset means billing shows "not configured," every org stays on Free.
- `NEXT_PUBLIC_CONTACT_EMAIL` — unset means the `/trust` responsible-disclosure
  section and `/contact` say so explicitly instead of showing a broken/fake
  contact path (`app/(marketing)/trust/page.tsx`).

## Never commit

None of the above belong in version control. `.env.example` documents the
variable *names* only. If a real value for any of these ever lands in a
commit, rotate it immediately — don't rely on removing it from a later
commit (git history still has it).

## Verifying a deployment's environment before go-live

Run through `docs/operations/production-checklist.md`'s Security and
Database sections — most of the checklist items that are deployment-time
(not code-time) are exactly "is this variable actually set."
