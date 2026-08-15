# Customer interview script

Goal: understand the prospect's real situation, not confirm what Aegis
already does. Ask open questions, don't lead them toward the answer that
flatters the product (`AGENTS.md` §51). Take notes verbatim where
possible — their words are what goes into `docs/customer-feedback.md`,
not a paraphrase that already fits the roadmap.

## Before the call

Read `docs/sales/target-account-template.md`'s `pain_hypothesis` for this
account, if one exists — but be ready to be wrong about it.

## Questions

1. How many AI agents do you run today, roughly?
2. Where do they run — production, staging, internal tools only,
   customer-facing?
3. What can they access — CRM, email, database, cloud infra, financial
   systems, something else?
4. Which of their possible actions actually worries you? Why that one
   specifically?
5. How do you currently control what they're allowed to do? (Probe:
   is this per-agent code, a shared library, nothing formal yet?)
6. How do you audit what they've done, after the fact?
7. How do you manage who inside your company can change an agent's
   permissions?
8. How do you measure what your AI usage costs, today?
9. Have you had an incident — an agent doing something it shouldn't have,
   even a near-miss?
10. What would make a tool like this mission-critical for you, versus
    "nice to have"?
11. Would you pay for this? Roughly how much, for what scope?

## Rules for the interviewer

- Don't pitch. This is discovery, not a demo — if they ask "does Aegis do
  X," it's fine to answer briefly, but steer back to their situation.
- Don't lead: ask "how do you control this today" before ever mentioning
  policies/approvals/audit as concepts, so their answer reflects their
  actual practice, not a reaction to your vocabulary.
- Write down the exact words for pain and for willingness-to-pay — these
  feed `docs/customer-research/feature-prioritization.md` and
  `docs/customer-feedback.md` directly.
- If they describe a problem Aegis doesn't solve, say so honestly rather
  than stretching the pitch to fit.

## After the call

Log the conversation in `docs/customer-feedback.md` (one row per distinct
piece of feedback, not one row per call) — problem, severity, frequency,
what they asked for in their words, current workaround, business impact,
and a real build/backlog/won't-build decision, not a placeholder.
