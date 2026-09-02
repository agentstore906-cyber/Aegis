# Metrics framework

Defines the funnel, activation criteria, time-to-value measures, and
customer-health/retention formulas Phase 10 asks for — as a framework tied
to real queries, not filled-in numbers. **No analytics provider is wired
up in this codebase** (`lib/analytics/track.ts`'s `trackEvent` only
`console.debug`s in dev) and **no real paying customers exist in this
environment**. Every number this document could show today would either
be zero/near-zero or fabricated — so it defines the formula and its real
source, and states plainly that it's unpopulated, rather than inventing
one to fill a chart.

## North Star

**Organizations with at least one active AI agent governed by Aegis** —
in this codebase, "governed" means the org has a real `PolicyEvaluation`
history, not just a connected agent with no policy activity.

## Activation

An organization is **activated** when all of the following are true
(implemented literally in `lib/onboarding/status.ts` and
`lib/admin/metrics.ts`'s `countActivatedOrganizations`):

1. Organization created (implicit).
2. Agent connected — `Agent` exists.
3. First event received — `ActivityEvent` exists.
4. First policy created — `Policy` or `AgentPermission` exists.
5. First evaluation completed — `PolicyEvaluation` exists.

The in-app onboarding checklist (`components/dashboard/onboarding-checklist.tsx`)
tracks two additional steps (approval workflow used, teammate invited) for
UI purposes, but they're not part of the activation definition above — kept
literal to the master prompt's own criteria so "activated" means one
specific thing everywhere it's used.

## Funnel

```
Visitors → Signups → Organizations → Agent Connected → First Event
  → First Policy → First Evaluation → Activated → Paid → Expansion
```

Every step through "Activated" is derivable today from real Prisma data
(no analytics provider needed) — see `/admin/metrics`. "Paid" is real too
(`Organization.subscriptionStatus`/`.plan`, Lemon Squeezy-mirrored). Conversion
*rates* between steps require enough volume at each step to be meaningful;
with a handful of organizations, a rate is noise, not signal — don't chart
percentages until there's a real cohort size behind them (a rough floor:
don't trust a rate computed from fewer than ~20 organizations at the
earlier step).

## Time to value

Three measures, each computable directly from existing timestamps once
there's real signup activity to measure:

- Signup → agent connected: `User.createdAt` → first `Agent.createdAt`
  for that org.
- Signup → first event: `User.createdAt` → first `ActivityEvent.timestamp`.
- Signup → activated: `User.createdAt` → the latest of the four activation
  criteria's earliest matching row.

Not implemented as a dashboard yet — the query shape is straightforward
(min/max timestamp joins per org) once there's a meaningful sample to make
a median/p90 worth looking at.

## Customer health

Signals (not yet an implemented score — a score built from near-zero data
would just be noise, and Phase 10's own rule is "do not create arbitrary
scores unless there is meaningful evidence"):

- Agent active (recent `ActivityEvent`).
- Policy/approval/security usage trend.
- Team adoption (`OrganizationMember` count, active members).
- Billing status (`subscriptionStatus`).

Proposed states once there's enough history to justify them: `HEALTHY`,
`ATTENTION`, `AT_RISK`, `INACTIVE` — each state should cite the specific
signal(s) that produced it (e.g. "no `ActivityEvent` in 14 days" +
"0 pending approvals resolved in 30 days"), never an opaque single number.

## Retention

Day 1 / 7 / 30 and Month 2/3 retention, standard cohort definition (of
organizations activated in period X, what fraction had activity in period
X+N). Requires real activation timestamps spread over real calendar time
to mean anything — this environment doesn't have that yet. Formula is
ready; the cohort isn't.

## MRR / revenue

`/admin/metrics` computes real MRR today: `sum(PLANS[org.plan].priceCents)`
over organizations with `subscriptionStatus === "active"` — Lemon
Squeezy-mirrored data, not projected. New/expansion/contraction/churn MRR (the delta
categories) need a time series of that same computation, which isn't
built yet — the base number is real; the trend isn't tracked over time
yet.

## What this explicitly is not

Not a claim that any of the above currently shows a meaningful trend —
most of it will show near-zero or "insufficient data" today. That's the
honest state of a product before real customers, not a gap to paper over.
