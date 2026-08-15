# Rollback

How to undo a bad deploy. There is no automated rollback tooling in this
repo (no CI/CD pipeline exists — see `docs/operations/release-process.md`);
this document is the manual procedure.

## Application rollback

Standard Next.js app: redeploy the previous known-good build/commit on
whatever platform hosts it. There's no in-app versioning or feature-flag
kill switch beyond what you build at the platform level — reverting the
deployed artifact is the mechanism.

1. Identify the last known-good commit (the one before the change that
   caused the problem).
2. Redeploy from that commit/tag. `npm run build` from a clean checkout of
   it, or trigger your platform's redeploy-previous-version action if it
   has one.
3. Confirm `GET /api/health` returns `200 {"status":"ok"}` after rollback.

## Database migration rollback

**Prisma migrations in this repo are forward-only** — there is no
`prisma migrate down`. This is a real constraint, not a missing feature to
build around casually: the schema already follows a rollback-friendly
discipline (additive changes, new columns nullable or defaulted, no
destructive drops in the same release as the code that depends on the new
shape — see the migration history under `prisma/migrations/`), which is
what makes "roll the app back a version" safe even after a new migration has
already run.

**If a bad migration has already been applied:**

- If the migration was purely additive (new table/column, new nullable
  field) — rolling the application code back is enough. The extra
  schema doesn't break older code.
- If the migration is genuinely wrong (bad column type, wrong constraint) —
  write a new **forward** migration that corrects it. Never hand-edit
  `prisma/migrations/` history or run a manual `DROP`/`ALTER` against
  production outside of a real migration — that desyncs the migration
  history from the actual schema for every future deploy.
- If data was already written in a shape the fix needs to account for,
  the corrective migration needs an explicit backfill step, not just a
  schema change.

**Never** run `prisma migrate reset` or `prisma db push --force-reset`
against a production database as a "rollback" — both are destructive resets,
not rollbacks (see `docs/deployment.md` §3).

## What a rollback trigger looks like

There's no automated health-check-triggered rollback. In practice: a
failing `GET /api/health`, a spike in 5xx responses, or a user-reported
regression after deploy is the signal — someone makes the call and performs
the manual steps above. This is a documented current limitation (no
automated deployment pipeline exists — see
`docs/operations/release-process.md`), not a claim that one does.
