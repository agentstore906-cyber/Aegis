# Enforcement: what Aegis can and cannot actually do

Aegis is a **control plane**, not an execution environment. It never runs
an agent's code and never sits in front of an agent's own API keys or
model provider account. Every capability described below is either
(a) something Aegis genuinely does — record a decision, raise an alert,
persist an audit trail — or (b) something a *connected agent's own
integration* would have to cooperate with for it to become real. This
document exists so that distinction never gets blurred in code, in the
UI, or in a response to a user.

## The core rule

> Never claim `BLOCKED`, `ENFORCED`, or `EXECUTED` unless there is actual
> evidence of it. Otherwise, say what actually happened: `RECORDED`,
> `DETECTED`, or `ALERT TRIGGERED`.

## Two request shapes, two different truths

Aegis's public API has two entry points, and they mean very different
things for enforcement:

- **`POST /api/v1/evaluate`** — "may my agent do this?" Called *before*
  the agent acts. If it returns `BLOCK`, and the calling integration
  actually honors that response by not proceeding, the action really was
  prevented. This is **cooperative enforcement**: real, but only as
  strong as the integration's own discipline about calling `/evaluate`
  first and obeying it. Aegis has no way to verify that discipline.
- **`POST /api/v1/events`** — "here's what my agent already did." Always
  after the fact. A `BLOCK`-worthy action reported here already happened;
  Aegis had no opportunity to prevent it. `lib/activity/ingest.ts` runs
  the same policy engine against these events purely to **detect** a
  violation, via the `POLICY_VIOLATION_DETECTED` security alert
  (`lib/security/detectors.ts#detectPolicyViolationAfterTheFact`) — and
  that alert is always worded as detection ("already performed an action
  that violates policy"), never as prevention.

See `docs/policy-engine.md` for the decision engine itself (`ALLOW` /
`BLOCK` / `REQUIRE_APPROVAL` / `ALERT`).

## The enforcement connector abstraction

`lib/enforcement/types.ts` defines `EnforcementConnector` — the extension
point for a future integration that could actually reach into a connected
agent (e.g. an SDK that polls its own control state and self-halts, or a
gateway that intercepts the agent's outbound calls). Every control action
returns an `EnforcementOutcome`:

```ts
type EnforcementOutcome = {
  enforced: boolean;       // true only with real evidence the agent was affected
  mechanism: string | null; // which connector did it, or null
  detail: string;           // always-truthful, user-facing sentence
};
```

Today, `lib/enforcement/null-connector.ts` (`NullEnforcementConnector`) is
the only connector, resolved for every agent by
`lib/enforcement/registry.ts#getEnforcementConnector`. It always returns
`enforced: false` with an explicit sentence explaining why. This is not a
placeholder to silently swap out later — it is the honest default, and
every caller (the kill switch, the firewall) is written to handle
`enforced: false` as the expected case, not an edge case.

## Agent Kill Switch (`lib/agents/control.ts`)

`Agent.status` (`ACTIVE` / `PAUSED` / `STOPPED` / `NEEDS_ATTENTION` /
`ARCHIVED`) is Aegis's *recorded* control state — what an operator wants,
not proof of what the agent is doing. Every transition:

1. Asks the enforcement connector to actually pause/resume/stop the
   agent (today: always `enforced: false`).
2. Writes the new status to the `Agent` row regardless.
3. Writes an immutable `AuditEvent` with the previous state, new state,
   actor, reason, and the enforcement outcome.
4. Dispatches a best-effort webhook (`agent.paused` / `agent.resumed` /
   `agent.stopped`) so an operator's own systems can react — but this is
   Aegis *notifying*, not Aegis *stopping*.

The UI (`components/agents/agent-status-toggle.tsx`) shows the
`EnforcementOutcome.detail` after every action, so "Aegis marked this
agent as stopped, but external enforcement is unavailable for this
connection" is the thing a user actually sees — never a bare "Agent
stopped."

## Budgets (`lib/costs/budgets.ts`)

Same discipline, different domain: exceeding a budget can never mean
"Aegis blocked this agent's spending" — Aegis has no billing relationship
with any model provider. `checkAgentBudgets` always raises a
`BUDGET_EXCEEDED`/`BUDGET_WARNING` alert worded as "alert triggered," and
the budgets panel repeats that limitation inline whenever a budget shows
as exceeded.

## What would change this

Adding a real connector means implementing `EnforcementConnector` against
an actual integration surface (e.g. the `@aegis/agent-sdk` package polling
its control state, or a gateway that can reject the agent's own outbound
requests) and returning it from `getEnforcementConnector` for agents that
have it configured. Until that exists, every "stop"/"block"/"budget
exceeded" surface in Aegis must keep saying what it actually did, not what
it wants to imply.
