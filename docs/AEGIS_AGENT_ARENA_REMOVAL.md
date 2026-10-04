# Agent Arena removal

Agent Arena (a benchmark score for a connected agent, public share scorecards, "challenge this agent") is no longer part of
Aegis. Aegis is an AI agent control plane; the Arena was a marketing loop, not a control-plane capability.

## 1. What was removed

Arena was fully self-contained. Nothing outside it imported from `lib/arena`, `components/arena` or the `arena_*` tables
(verified by search and by the compiler).

| Area | Removed |
|---|---|
| Dashboard routes | `/arena`, `/arena/[id]`, `/arena/loading` |
| Public routes | `/a/[slug]` (scorecard page), `/a/[slug]/opengraph-image`, `/a/[slug]/challenge` |
| Components | `components/arena/*` (6 files) |
| Library | `lib/arena/*` (11 files: actions, analytics, authorization, benchmark, challenge, metrics, queries, scenarios, scoring, share, types) |
| Tests | `lib/arena/__tests__/scenarios.test.ts`, `scoring.test.ts` (15 tests) |
| Docs | `docs/agent-arena.md` |
| Nav | "Agent Arena" item (Fleet group) and its icon import in `lib/dashboard-nav.ts` |

## 2. Frontend

Navigation Fleet group is now: Agents, Risk scanner. No placeholder, card or empty section replaced the entry. No marketing,
onboarding or dashboard component referenced Arena. Old URLs (`/arena`, `/arena/<id>`, `/a/<slug>`) no longer match a route and
get the application's normal 404; nothing redirects to an unrelated feature. Previously shared `/a/<slug>` links therefore stop working.

## 3. Backend

No API routes, background jobs, cron entries or webhooks belonged to Arena (it used server actions and the two public routes above).
`lib/agents/handshake.ts` only had a comment mentioning Arena; reworded.

## 4. Database

New migration `prisma/migrations/20261012120000_remove_agent_arena/migration.sql`:

```sql
DROP TABLE IF EXISTS "arena_scenario_results";
DROP TABLE IF EXISTS "arena_challenge_attributions";
DROP TABLE IF EXISTS "arena_analytics_events";
DROP TABLE IF EXISTS "arena_scorecards";
DROP TYPE IF EXISTS "ArenaScorecardStatus";
```

- The four tables had **no foreign keys** to Organization, Agent or User (scalar ids only), so no shared security data is affected.
  Their only FKs were between each other. Models and enum were removed from `prisma/schema.prisma`.
- **This is destructive and irreversible**: all scorecards, results, challenge attributions and funnel analytics are deleted.
  `npm run build` runs `prisma migrate deploy`, so **deploying will drop the data in production**. Take a backup first if the
  Arena data (e.g. public scores) has any value.
- Applied only to the local test database here. `prisma migrate diff` against it shows no drift from the schema.
- The original migration `20260903120000_add_agent_arena` is kept: applied migrations are history and must not be edited.

## 5. Shared infrastructure preserved

Agents, permissions, policies, activity, risk, trust, incidents, audit, approvals, the control engine, the risk scanner
(`RiskScan`, which follows the same "no foreign keys" pattern but is a separate feature) and the rate limiter are untouched.
Auth and authorization code was not changed.

## 6. Tests

Removed only the 2 Arena test files (15 tests). Full suite after removal: 1343 tests in 103 files; 1339–1340 pass.
Failures seen (all in code this change did not touch):

- `p2-behavioral-memory` "today never teaches itself" and "extreme volume event" — time-of-day dependent, flaky before this change.
- `p3-agent-trust` "daily cron" — 5 s timeout under load, flaky before this change; also logs a transaction-closed error from a concurrent teardown.
- `p5-risk-control` shadow-mode test — failed once in a full run, passed alone.

I did not run these against the pre-removal commit to prove they fail there; the reasoning is that none import Arena code.

## 7. Build / type-check / lint

- `tsc --noEmit`: clean (after the build regenerated `.next/types`).
- `eslint .`: 0 errors, 4 pre-existing warnings.
- `next build` (against the local test database): succeeds, no Arena routes in the output.

## 8. Remaining references

Intentional only: this document and the CHANGELOG entry; the original and the drop migrations; historical notes in
`docs/AEGIS_UX_AUDIT.md` (marked historical), `AEGIS_MOAT.md`, `AEGIS_UI_IMPLEMENTATION.md`, `AEGIS_V2_ROADMAP.md`.

## 9. Migration required

Yes: `20261012120000_remove_agent_arena` (see §4). Not browser-verified: the Chrome extension was unavailable, so nav and
404 behavior were checked by build output and code, not by clicking through the app.
