# Competitive research

Structural template, deliberately left unpopulated for specific
competitors — same reasoning as `docs/customer-feedback.md`: any row here
would need to be verified against that competitor's actual current
pricing, positioning, and product, not assumed or guessed
(`AGENTS.md` §73: "do not make unsupported claims"). Fill in real rows
only after direct research (their site, docs, pricing page, and ideally a
prospect who evaluated both).

## Row structure

| Field | What to capture |
|---|---|
| Competitor | Company/product name |
| Positioning | Their own stated positioning, in their words |
| Target customer | Who they appear to sell to |
| Strength | A real, verifiable strength — not a guess |
| Weakness | A real, verifiable gap — ideally confirmed by a prospect who evaluated them, not assumed |
| Pricing | Current public pricing, with the date you checked it (pricing changes) |
| Integration | What they actually integrate with, per their own docs |
| Differentiation | Where Aegis is genuinely different — not just "we're better" |

## Categories worth tracking

Rather than naming specific companies without current verification, track
these adjacent categories and research real players in each as they
become relevant to a specific deal:

- **AI observability / tracing** — tools that show what a model or agent
  did, for debugging/quality, not for authorization or approval. Likely
  the most common "don't we already have this" objection — see
  `docs/sales/objections.md`.
- **General IAM / PAM** — identity and privileged-access tools, which
  govern *who* can access *what system*, not what an already-authorized
  agent is allowed to *do* action-by-action.
- **Policy-as-code engines** — general-purpose policy evaluation
  infrastructure not specific to AI agents; likely to come up with
  platform teams that already have opinions on policy tooling.
- **Internal/homegrown tooling** — the most common real competitor at
  this stage isn't another vendor, it's a team's own first-pass approval
  script. See `docs/sales/objections.md`'s "why can't we build this
  ourselves."

## When a prospect names a specific competitor

Ask what they evaluated and why it didn't stick (or why they're still
comparing) — that's a real data point for the table above. Log it here
with the date and source (which prospect, anonymized if needed), not as
an assumption applied to every future conversation.
