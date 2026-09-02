# Release process

**No CI/CD pipeline exists in this repo today** (no `.github/workflows` or
equivalent). This document describes the actual manual process, not an
aspirational automated one.

## Current process (manual)

1. **Develop** locally against a local Postgres (`README.md`'s "Local
   setup").
2. **Before opening/merging a change**, run the same checks
   `docs/operations/production-checklist.md` expects to already be green:
   ```bash
   npx prisma validate
   npx tsc --noEmit
   npm run lint
   npm test
   npm run build
   ```
3. **Review migrations** if the change includes one — `prisma/migrations/`
   diffs should be additive/backward-compatible per
   `docs/operations/rollback.md`.
4. **Deploy**: `npx prisma migrate deploy` against the target database,
   then deploy the built application (see `docs/deployment.md` §3–5).
5. **Verify**: `GET /api/health` returns `200`, then walk
   `docs/smoke-test.md`'s manual smoke test for anything the change touched.

## Environments

This repo doesn't prescribe a staging environment — none is configured here.
If you run one, it should be a separate `DATABASE_URL` and, if billing is
enabled, a separate Lemon Squeezy **test-mode** store (never point a staging
environment at a live Lemon Squeezy store or a production database).

## What's missing, honestly

- **No CI**: nothing runs the checks in step 2 automatically on push/PR.
  Anyone merging a change is currently responsible for having run them
  locally.
- **No automated deploy pipeline**: deploys are manually triggered,
  whatever your hosting platform's mechanism is.
- **No changelog/versioning convention** is enforced by tooling — `git log`
  is the record.
- **No automated rollback trigger** — see `docs/operations/rollback.md`.

Adding real CI (a GitHub Actions workflow running the same five commands
above on every PR) is the highest-leverage next step here and doesn't
require any infrastructure decision beyond "use GitHub Actions" — it's
listed as a gap rather than silently built into this pass because doing it
well means also deciding on a test database strategy for CI, which is a real
decision, not a default to assume.
