# Aegis — one-pager

*Internal sales reference. Every claim here is checkable against the code
in this repo — see the "Source" column at the bottom. Nothing below is
aspirational or planned; if a capability isn't shipped, it isn't listed
here as if it were.*

## 1. Problem

Companies are shipping AI agents into production faster than they can
govern them. An agent can read data, write data, call APIs, send email,
touch production infrastructure, and spend money — usually with
credentials scoped far wider than the task requires, and with no human in
the loop unless someone remembers to build one in, one-off, per agent.

The result: no central answer to "what did our agents do today," "what
are they allowed to do," "who approved that," or "what is this costing
us" — until something goes wrong and someone goes looking through logs
that were never built for this.

## 2. Why now

AI agents are moving from demos to production workflows — CRM, support,
finance, deployment — across companies of every size. The tooling for
*building* agents (frameworks, model APIs) has matured quickly. The
tooling for *governing* them once they're live has not kept pace. That gap
is where Aegis sits.

## 3. Solution

Aegis is a control plane that sits between an AI agent and the actions it
takes. Every action can be logged, evaluated against policy, routed for
human approval when it's sensitive, and audited after the fact — without
Aegis executing the action itself.

## 4. Product

- **Agents & Activity** — every registered agent, every structured action
  it reports, filterable and searchable.
- **Policy engine** — baseline per-agent permissions plus conditional
  policies ("refunds over $500 require approval"), resolved deterministically:
  `BLOCK` beats `REQUIRE_APPROVAL` beats `ALLOW`, and an action that matches
  nothing fails closed to `BLOCK`.
- **Approvals** — a `REQUIRE_APPROVAL` decision becomes a real request a
  human reviews and resolves, race-safe against two people acting at once.
- **Audit trail** — append-only record of every policy/permission/agent
  change and every approval state transition.
- **Security alerts** — six deterministic, explainable detectors (first-ever
  sensitive action, block spike, failure loop, new tool, high-risk burst,
  cost spike) — not a black-box model.
- **Cost intelligence** — spend by agent/provider/model/task/team, cost
  anomalies, cost-per-successful-task.
- **RBAC** — six roles (Owner/Admin/Engineer/Security/Finance/Viewer) with
  a central capability map, not scattered role checks.
- **Public API + SDK** — `@aegis/agent-sdk`, a real external agent process
  authenticates with an API key, reports activity, and asks for a decision
  before acting.

## 5. Architecture

```
Company
  → AI Agent
    → Aegis SDK / API
      → Aegis control plane
        → Policy engine → ALLOW / REQUIRE_APPROVAL / BLOCK
      → Tool / AI provider (your agent decides what to do with the decision)
      → Audit + Activity + Security + Cost
```

Aegis is a control layer, not an execution layer: it tells your agent
process what the decision is; your own code (or the SDK's
`waitForApproval`) decides what to do next. See `docs/api.md`.

## 6. Security

- Every tenant-owned row is `organizationId`-scoped; queries are re-scoped
  server-side, never trusted from the client.
- API keys are SHA-256-hashed, never stored raw, revocable, with optional
  expiration.
- Outbound webhooks are HMAC-signed and SSRF-checked at creation *and*
  delivery.
- Secrets in caller-supplied JSON are redacted at every persistence point.
- See `docs/security/questionnaire.md` and `/trust` for the full picture,
  including honest gaps (no SSO yet, retention is config-only today).

## 7. Use cases

| Agent type | Risky action | Aegis control |
|---|---|---|
| Finance | Issue a $1,250 refund | Policy requires approval above $500 |
| Sales | Bulk-export the customer list | Blocked; trips a security alert |
| Engineering | Deploy to production | Policy requires approval |

## 8. Pricing

Free / Startup ($99/mo) / Growth ($299/mo) / Business ($999/mo) /
Enterprise (custom). See `/pricing` — the page reads live from
`lib/billing/plans.ts`, the same config billing enforces, so this can't
drift from what the product actually does. Treat these as current, not
final — see `docs/customer-feedback.md`.

## 9. CTA

- Developer: sign up free, connect an agent, see a decision in under 10
  minutes (`/developers/quickstart`).
- Evaluator: `/demo` — a fully interactive, clearly-labeled sample
  environment, no signup required.
- Buyer: `/contact` — real lead capture, routed to a person.
