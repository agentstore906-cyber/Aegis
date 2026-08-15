# Feature prioritization framework

Used to decide what to build next, once real customer feedback exists in
`docs/customer-feedback.md`. Do not prioritize a feature because it's
technically interesting to build (`AGENTS.md` §52) — every entry below
must trace back to real evidence, not a hunch.

## Scoring dimensions

For each candidate feature, score 1–5 on each dimension using evidence
from `docs/customer-feedback.md` and `docs/customer-research/interview.md`
notes — not guesses:

| Dimension | What it measures | Evidence source |
|---|---|---|
| Problem frequency | How often this comes up across distinct customers/prospects | Count of feedback-log rows citing it |
| Problem severity | Blocker vs. annoyance, in the customer's own words | The "Severity" column in the feedback log |
| Revenue impact | Would this unblock a deal, an upgrade, or prevent churn | Explicit statement from a prospect/customer, not inference |
| Security impact | Does this close a real gap (see `docs/security/questionnaire.md`'s open items) | Cross-reference against known gaps |
| Willingness to pay | Did the customer say they'd pay more, or that this is why they'd buy | Direct quote, not assumption |
| Implementation complexity | Rough size — days vs. weeks vs. requires new infrastructure | Engineering estimate |

## Process

1. Every row in `docs/customer-feedback.md` gets scored, not just the
   ones that sound compelling.
2. A feature with high frequency + high severity + explicit willingness
   to pay from 3+ independent conversations outranks a feature one loud
   prospect asked for once, regardless of how interesting it is to build.
3. Do not build from a single conversation unless it's strategically
   necessary (e.g., blocks the only pilot in progress) — say so explicitly
   when that's the reason, rather than dressing it up as broad demand.
4. Re-run this scoring after every batch of 5–10 new customer
   conversations, not once and never again.

## What this framework deliberately excludes

- Competitor feature-parity as a reason on its own — see
  `docs/gtm/competitive-research.md`. Matching a competitor's feature list
  isn't evidence real customers need it.
- Internal enthusiasm ("this would be cool") — not a scoring dimension.
- Anything without at least one real customer/prospect data point. If
  there's no evidence yet, the answer is "talk to more customers," not
  "build it and see."
