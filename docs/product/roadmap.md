# Roadmap

Now / Next / Later, driven by gaps this codebase already documents about
itself, real customer feedback once it exists (see
`docs/customer-research/phase-10-interview.md` and
`docs/customer-feedback.md`), and the priority criteria in
`docs/customer-research/feature-prioritization.md`. No dates — this repo
doesn't promise delivery timing it can't back up, and priority here is
provisional until real usage (`/admin/metrics`,
`docs/customer-feedback.md`) confirms or reorders it.

## Now

Nothing is currently in active build beyond what Phase 10 itself just
shipped (onboarding checklist, feedback loop, invitation fixes, internal
metrics — see `CHANGELOG.md`). Per the strategic stop condition below,
the priority right now is **collecting real usage and feedback**, not
building the next thing.

## Next

Concrete, already-identified gaps — ordered roughly by how directly they
block a real customer, not by build effort:

- **CI pipeline** — no `.github/workflows` exists; every check
  (`tsc`, lint, `prisma validate`, tests) is run manually today. See
  `docs/operations/release-process.md`. Highest-leverage item on this
  list: it doesn't require a product decision, just infrastructure.
- **Real channel back to the agent** — an `APPROVED` decision can only be
  discovered by the SDK polling `GET /api/v1/approvals/:id`; there's no
  push/webhook-based resume path yet. Matters more as soon as a real
  agent's workflow is genuinely blocked waiting on a human.
- **Scoped API key picker** — `scopes` and per-endpoint `requireScope()`
  enforcement already exist (`docs/api.md`); every key is still created
  with the full default scope set because there's no creation-time picker
  UI yet.
- **Scheduler/background-job runner** — unlocks two things currently
  documented as configuration-only: retention actually deleting data
  (`docs/retention.md`) and webhook delivery moving off best-effort inline
  onto a durable queue with real retries (`docs/webhooks.md`). A real
  infrastructure decision (cron trigger vs. queue worker), not a small
  patch — don't build a bespoke one for a single feature.
- **Stripe verified against a real test-mode account** — the integration
  is real (signature verification + idempotency, tested against synthetic
  events), just never exercised against Stripe itself in this environment.
  Table stakes before real billing.

## Later

Larger, or explicitly blocked on real customer signal:

- **Real SSO/SAML** — `Organization.ssoEnabled`/`.ssoProvider` are schema
  placeholders only. Build when an actual prospect requires it, not
  speculatively (Phase 10 §41: "Talk to Sales" until then).
- **Activation/retention/customer-health dashboards with real trend
  lines** — the formulas are defined (`docs/gtm/metrics.md`), the data
  isn't there yet. Build once there's a cohort large enough for a trend
  to mean anything, not before.
- **Case studies, testimonials, social proof** — infrastructure
  (`docs/customer-research/`, `/trust`) exists to capture these honestly;
  populate only with real, permissioned customer content, never before
  then.
- **Trial period** — deliberately not built in Phase 10 (see
  `docs/gtm/metrics.md`'s billing section and this phase's own scope
  notes); revisit if real prospects ask for one specifically, not as a
  default SaaS pattern.
- **Pricing changes** — current plan prices/limits are explicitly marked
  experimental (`lib/billing/plans.ts`); any change needs a real
  hypothesis/segment/metric per the master prompt's own pricing-experiment
  rule, not a guess.

## Strategic stop condition

After this phase: don't start another feature phase automatically. Collect
real usage against the criteria in `docs/gtm/metrics.md` and real
conversations via `docs/customer-research/phase-10-interview.md` first —
let that decide what actually moves from Next to Now.
