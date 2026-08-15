# Phase 10 customer interview script

Companion to `docs/customer-research/interview.md`, which is a **pre-sale**
discovery script (understand the prospect's situation before they've used
Aegis). This one is **post-activation**: for an organization that has
actually connected an agent and used the product, not a prospect. Goal:
find out whether Aegis is actually valuable in practice, not whether the
pitch landed.

No customer has run through this yet in this environment — this is the
script to use once one has, not a summary of answers already collected.
Real answers go in `docs/customer-feedback.md`, same as the pre-sale script
— one row per distinct piece of feedback.

## Who to run this with

An organization that's cleared onboarding (see the activation criteria in
`docs/gtm/metrics.md`) and has been using Aegis for at least a couple of
weeks — long enough to have a real usage pattern, not just a first
impression.

## Questions

1. What do you use Aegis for, in your own words?
2. What's the most valuable feature — the one thing you'd be upset to lose?
3. What would you miss if Aegis disappeared tomorrow?
4. What do you check most often? (Probe: is it a specific page — approvals,
   security, cost — or do they not have a routine at all yet?)
5. What's confusing? Where did you get stuck or have to guess?
6. What feels unnecessary — built but unused?
7. What's preventing you from connecting more agents / rolling this out
   wider inside your org?
8. Would you connect more agents if [specific blocker they named] weren't
   a problem?
9. What would make Aegis mission-critical for you, versus something you
   check occasionally?

## Rules for the interviewer

Same discipline as the pre-sale script: don't lead, don't pitch, write
down exact words for value and for friction — paraphrasing at interview
time is how real signal gets lost before it ever reaches
`docs/customer-research/feature-prioritization.md`.

## After the call

1. Log in `docs/customer-feedback.md`, same format as pre-sale feedback.
2. Cross-check anything they say is "most valuable" or "most confusing"
   against real usage signals for that org (`/admin/metrics`,
   `PolicyEvaluation`/`ApprovalRequest`/`ActivityEvent` counts) — does
   what they say they use match what they actually do? A mismatch is
   itself a finding worth writing down, not a contradiction to resolve
   away.
3. Feed anything that looks like a pattern (not a one-off ask) into
   `docs/product/roadmap.md`'s Next/Later columns — per
   `docs/customer-research/feature-prioritization.md`'s existing
   criteria, not built from a single request unless it's strategically
   important: evidence → pattern → problem → priority, not
   evidence → build.
