# Customer success scorecard

Tracks the signals Phase 10 §98 asks for, per organization. **Unpopulated
today** — this environment has no real customers to score yet. Each row
names the real query/table that will supply it once there is one, so this
is immediately usable rather than a template someone has to design later.

## How to use this

Once there are real organizations using Aegis, fill one row per customer
(a simple table below, or pull the same fields into a real view if this
grows past a handful of rows — don't build a CRM for this, per Phase 10
§46). Update on whatever cadence customer success actually reviews
accounts (weekly/monthly) — this doc doesn't prescribe one, since there's
no team rhythm yet to match it to.

## Signals and their real source

| Signal | Source |
|---|---|
| Activation | `lib/onboarding/status.ts`'s `getOnboardingStatus` — the same criteria `/admin/metrics` uses for "Activated" |
| Usage | `ActivityEvent`/`PolicyEvaluation`/`ApprovalRequest` counts and recency for the org |
| Retention | See `docs/gtm/metrics.md`'s cohort definition — not computable yet at real scale |
| Expansion | Agent/member/API-key count trend vs. plan limit (`lib/billing/entitlements.ts`'s limits); a plan upgrade event |
| Support | Manual — no ticketing system exists (Phase 10 §92 explicitly says not to build one); track informally until volume justifies more |
| Security | `SecurityAlert` count/severity for the org, resolution time |
| Value | `docs/customer-feedback.md`'s logged "what they said is valuable" entries, cross-checked against real usage (see `docs/customer-research/phase-10-interview.md` step 2 of "after the call") |
| Renewal | `Organization.subscriptionStatus`/`.cancelAtPeriodEnd`/`.currentPeriodEnd` |

## Health state

Use the states defined in `docs/gtm/metrics.md`'s Customer health section
(`HEALTHY` / `ATTENTION` / `AT_RISK` / `INACTIVE`) — every state assigned
to a real customer must cite the specific signal(s) above that produced
it. Never assign a state without a cited reason; an unexplained status is
worse than no status.

## Table (fill in as real customers exist)

| Organization | Activation | Usage trend | Health | Plan | Renewal date | Notes |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |
