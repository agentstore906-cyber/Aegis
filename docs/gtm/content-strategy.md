# Content strategy

Goal: be the thing that shows up when someone searches for AI agent
governance, permissions, or production incidents — not generic AI-tools
listicle content (`AGENTS.md` §58).

## Core themes

- AI agent security — what can go wrong when an agent has too much access
- AI agent permissions — baseline vs. conditional policy, fail-closed design
- AI agent governance — who's accountable when an agent acts
- AI agent observability — how this differs from tracing/eval tooling
  (see `docs/sales/objections.md`'s answer on this)
- AI agent costs — tracking spend per agent/task, catching anomalies
- Human approval / human-in-the-loop — designing approval flows that
  don't become rubber-stamping
- AI infrastructure — where a control plane sits relative to the rest of
  the stack
- Production AI agents — the gap between a demo and something that runs
  unattended
- AI agent incidents — real postmortem-style thinking (never fabricated
  incidents attributed to real companies)

Every piece should teach something a technical reader didn't already
know — a real architecture pattern, a real threat model, a real tradeoff
in an approval-flow design. Avoid "10 AI tools you need in 2026" — that
content earns clicks, not the technical-buyer trust this product needs.

## Prioritize technical content

- Architecture diagrams (agent → SDK → policy engine → decision → audit)
- SDK tutorials (real code, drawn from `packages/agent-sdk/README.md` and
  `docs/api.md` — never invented API shapes)
- Policy examples (real patterns: amount thresholds, environment-scoped
  rules, first-use detection)
- Agent security patterns and threat models
- Production governance guides
- Approval-workflow design (race conditions, idempotency, expiry — real
  problems this product actually solved, see `docs/approvals-and-audit.md`)
- Cost control for AI agent fleets

This content attracts the technical buyer (AI engineer, platform
engineer) who influences or makes the buying decision — see
`docs/sales/outreach.md`'s AI Engineer template for the matching outbound
angle.

## What to avoid

- Generic AI hype content unrelated to agent governance specifically.
- Any claim of a customer, metric, or integration not yet real
  (`AGENTS.md` §0).
- Content that only makes sense to someone who already uses Aegis —
  everything should be useful even to someone who never signs up.

## Channels

See `docs/gtm/founder-sales.md` for the daily workflow this content
strategy feeds — LinkedIn and Reddit posts should link back to a specific
technical piece, not just the homepage.
