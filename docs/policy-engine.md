# Policy engine (Phase 2)

This document covers the design of Aegis's policy engine: the code in
`lib/policies/`, the `AgentPermission` / `Policy` / `PolicyCondition` /
`PolicyEvaluation` tables, and the decision algorithm they implement.

## Two layers

**Agent permissions** are the baseline. Each row answers "is this agent
generally allowed to do X?" for one `(agent, action, resource)` scope.

**Policies** are conditional rules layered on top. Each one answers "under
these conditions, what should Aegis do?" — optionally scoped to a specific
agent, action, resource, environment, tool, or risk level, and optionally
gated by one or more `field <operator> value` conditions (all combined with
AND).

Both layers resolve to the same four decisions: `ALLOW`, `REQUIRE_APPROVAL`,
`BLOCK`, `ALERT`. There is no fifth "maybe" state — the engine always picks
one.

## Evaluation sequence

```
Agent action (evaluateAgentAction input)
        |
        v
Load AgentPermission rows for this agent  --->  resolveBestPermission()
        |                                        (lib/policies/matcher.ts)
        v
Load active Policy rows for this agent
+ org-wide policies, with their conditions --->  filterApplicablePolicies()
        |                                        (scope match + AND'd conditions)
        v
resolveDecision(permission, matchedPolicies, input)
        |                                        (lib/policies/resolver.ts)
        v
ALLOW / REQUIRE_APPROVAL / BLOCK / ALERT + human-readable reason
        |
        v
Persist PolicyEvaluation + a linked ActivityEvent, in one transaction
        |
        v
ALERT only: raise a SecurityAlert (upsertAlertFinding) — the action has
already proceeded; this is not an enforcement point
```

`lib/policies/evaluate.ts` is the only place that orchestrates all of this.
It has no Next.js-specific types in its signature, so it can be called from
a Server Action, an internal route, or — once Phase 4 ships API keys — an
authenticated SDK ingestion endpoint, without changing its shape.

## Decision precedence

Severity, strictest first: **BLOCK > REQUIRE_APPROVAL > ALERT > ALLOW**.

The baseline permission and every policy that matches scope + conditions
each contribute a decision. The engine takes the strictest one across all of
them — a single matching `BLOCK` always wins, no matter how many other rules
would `ALLOW`. This holds regardless of a policy's `priority`.

`ALERT` is deliberately *not* an enforcement point: the action proceeds
exactly as it would under `ALLOW` (see `DECISION_TO_ACTIVITY_STATUS` in
`lib/policies/evaluate.ts`, which maps it to the `WARNING` activity status,
never `BLOCKED`). What it adds is a side effect — `evaluateAgentAction`
raises a `SecurityAlert` (via the same `upsertAlertFinding` every detector
uses, so it dedupes/audits identically) sized to the winning policy's
`severity`. Never report an `ALERT` decision as having stopped anything.

**`priority` only breaks ties in the explanation**, not the decision. If two
policies both land at the winning severity (e.g. two different `BLOCK`
policies both matched), the one with the higher `priority` is used to build
the human-readable reason. Every matched policy is still recorded in
`matchedPolicySnapshots` — conflicts are surfaced, never hidden.

**Default: fail closed.** If neither the baseline permission nor any policy
matches an action at all, the result is `BLOCK`, with the reason "no
permission or policy matched … unconfigured actions are blocked by
default." An agent's capabilities are opt-in, not opt-out.

## Baseline permission resolution

Permissions can target an exact action (`refund.issue`) or a `prefix.*`
wildcard (`crm.*`), and an exact resource or `""` (any resource). When more
than one row could apply, the most specific one wins, in this order:

1. exact action + exact resource
2. exact action + any resource
3. wildcard action + exact resource
4. wildcard action + any resource

An exact-action row always outranks a wildcard-action row, regardless of
resource specificity — a targeted permission can't be shadowed by a broad
one covering the same action family. See `resolveBestPermission` in
`lib/policies/matcher.ts`.

## Condition operators

`EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`,
`LESS_THAN_OR_EQUAL`, `IN`, `NOT_IN`, `EXISTS`.

Numeric operators require both sides to parse as finite numbers — a
condition comparing `"hello" > 500` never silently coerces to `0`. What an
incomparable or missing value *means* depends on the policy's decision —
see "Missing and unusable fields" below. `IN`/`NOT_IN` compare against a list. `EQUALS`/`NOT_EQUALS`
compare via string coercion, so they work across strings, numbers, and
booleans consistently.

A condition's `field` is resolved through a fixed whitelist (see
`resolveField` in `lib/policies/conditions.ts`): `context.<path>` (up to 5
levels into the caller-supplied context object) or one of `action`,
`resource`, `environment`, `tool`, `riskLevel`, `agentId`. There is no
`eval`, no `Function()` constructor, and no user-supplied expression
language — conditions are data, evaluated by fixed code paths, never code.

### Telemetry fields — destinations, services, data, volume (control plane)

Policies can also reference what the request says about **where data goes and
what it touches** — the least-privilege levers for "this agent may only reach
these hosts" or "never credentials":

| Field | Value |
|---|---|
| `destination` | the host the action reaches (host-only, normalized) |
| `service` | the service/API the action calls (normalized key) |
| `dataSensitivity` | `LOW` `MEDIUM` `HIGH` `CRITICAL` — derived from the data classes; a caller's own declaration can only raise it |
| `recordCount`, `byteCount` | volume (numbers; `GREATER_THAN` etc. work) |
| `data.<CLASS>` | `true`/`false` per class: `data.PUBLIC`, `data.INTERNAL`, `data.CONFIDENTIAL`, `data.PII`, `data.FINANCIAL`, `data.HEALTH`, `data.CREDENTIALS` |

Examples: **BLOCK** `crm.export` when `destination` **NOT_IN** `["api.crm.example.com"]`
(an allow-list); **BLOCK** when `data.CREDENTIALS` **EQUALS** `true`;
**REQUIRE_APPROVAL** when `dataSensitivity` **IN** `["HIGH","CRITICAL"]`;
**BLOCK** when `recordCount` **GREATER_THAN** `1000`.

Two rules you must know:

1. **Unreported is not "none".** A field the request did not report is
   *indeterminate*. Under STRICT matching (below) an indeterminate condition
   **matches restrictive policies** (BLOCK / REQUIRE_APPROVAL / ALERT) and does
   **not** match ALLOW. So the allow-list above blocks a request that omits its
   destination: an agent cannot slip past it by staying silent. `data.PII` is
   `false` only when the request reported its data classes and PII was not among
   them; if classes were never reported it is unreported, not `false`.
2. **These are agent-reported.** `environment` and `riskLevel` come from Aegis's
   own records; a destination or data class is whatever the integration says.
   A policy on them is exactly as strong as the integration's honesty, until
   something that *observes* the destination (a gateway) exists. They constrain
   a cooperative agent and make evasion by omission impossible; they do not
   defeat a lying one. End-user ids are never addressable by policy.

`LEGACY` matching (the explicit pre-P0 opt-out) keeps its old semantics: a missing
field makes the condition false.

## Missing and unusable fields (P0)

Before P0, a scoped or conditioned policy simply didn't match when the
caller left the field out — so "BLOCK `payments.*` in PRODUCTION" was
bypassed by omitting `environment`, and "BLOCK refunds where amount > 1000"
by omitting `amount`. STRICT matching (the default for every organization,
`lib/policies/matcher.ts` + `lib/policies/decision-context.ts`) closes this:

1. **Trusted context first.** `environment` comes from the Agent record for
   agent callers (a different claimed value is ignored for matching and
   stored as `PolicyEvaluation.claimedEnvironment`). `riskLevel` is
   `max(claimed, agent's configured level, Aegis's own rule-based score)` —
   a caller can raise it, never lower it (`claimedRiskLevel` keeps a lower
   claim as evidence). The dashboard policy tester is an operator
   simulation and may pick the environment explicitly.
2. **Unknown fails closed for restrictive rules.** For `BLOCK`,
   `REQUIRE_APPROVAL`, and `ALERT` policies, a scope field
   (`resource`, `environment`, `tool`, `riskLevel`) the input doesn't carry
   counts as a **match**, and a condition whose field is missing, `null`, or
   not comparable (e.g. `amount: "lots"`) counts as **satisfied**.
3. **Unknown never grants.** For `ALLOW` policies the same cases count as a
   **non-match**.
4. **Risk scopes are thresholds for restrictive rules.** A `BLOCK` /
   `REQUIRE_APPROVAL` / `ALERT` policy scoped to `riskLevel: HIGH` applies
   to HIGH **and CRITICAL**. ALLOW risk scopes stay exact (never widened).
5. **`EXISTS` is never indeterminate** — absence is exactly what it tests.
6. **Resource-scoped permissions.** With `resource` omitted, a
   resource-scoped `BLOCK`/`REQUIRE_APPROVAL`/`ALERT` permission for the
   action is weighed against the any-resource permission and the stricter
   one wins; a resource-scoped `ALLOW` is never credited.

Net effect: omitting information can only make a decision stricter, never
looser. Every evaluation records `matchingMode` (`STRICT`/`LEGACY`).

**Compatibility opt-out.** `Organization.legacyPolicyMatching = true`
restores the pre-P0 matcher (caller-declared context, omitted field = no
match) for that organization only. There is deliberately no dashboard
toggle — it weakens security — so it is applied by support with a direct
database `UPDATE` (not captured by the in-app audit trail — record it in your change log), recorded on every evaluation as `matchingMode: LEGACY`, and
meant to be temporary while an integration is fixed to send complete
context. It never disables the kill switch, approval binding, or any other
P0 fix. See `docs/AEGIS_P0_IMPLEMENTATION.md` §2.

## Security assumptions

- **`organizationId` is never client input.** Every call site resolves it
  from the caller's authenticated session (`requireActiveOrganization()`)
  before it reaches the engine. `evaluateAgentAction` additionally verifies
  the target agent actually belongs to that organization before evaluating
  anything, and throws otherwise.
- **Tester input is capped and sanitized.** The policy tester's free-form
  JSON context is parsed by `lib/policies/safe-context.ts`: max 4000
  characters, max nesting depth 4, max 50 keys, and any `__proto__` /
  `prototype` / `constructor` key is rejected outright.
- **Every mutation is authorization-checked server-side**, via
  `lib/policies/authorization.ts` (`canManagePolicies`,roughly
  OWNER/ADMIN/SECURITY; `canManageAgentPermissions`, those plus ENGINEER).
  UI affordances are hidden for users who lack access, but that's a
  convenience, not the enforcement — every Server Action re-checks the
  caller's role itself.
- **Never swallow an evaluation error into a silent ALLOW.** If
  `evaluateAgentAction` can't complete (bad agent, DB error), it throws.
  There is no `catch` anywhere in the engine that downgrades a failure into
  a permissive default.

## Auditability: why `PolicyEvaluation` has no foreign key to `Policy`

`PolicyEvaluation.matchedPolicyIds` and `.permissionId` are plain string
fields, not Prisma relations. `matchedPolicySnapshots` and
`permissionSnapshot` capture the matched name/decision/priority *at
evaluation time*. This is deliberate: editing or deleting a policy later
must never change what a past evaluation says happened, and must never
break under a foreign-key constraint when someone deletes a policy that has
history attached to it.

## What Phase 2 deliberately doesn't do

- No policy DSL, no glob/regex actions (only exact match and a single
  `prefix.*` wildcard segment), no visual rule builder, no policy
  versioning beyond the evaluation-time snapshot described above.

Phase 3 (see [`docs/approvals-and-audit.md`](approvals-and-audit.md)) added
the two things this section used to list as missing: `evaluateAgentAction`
now creates a real `ApprovalRequest` when it resolves to `REQUIRE_APPROVAL`,
and permission/policy/agent CRUD, plus every approval state change, is
written to an append-only `AuditEvent` table.

## Test scenarios

`prisma/seed.ts` runs a fixed set of scenarios through the real engine
(`lib/policies/matcher.ts` + `resolver.ts`, the same code the app uses) so
the seeded evaluation history is trustworthy, not hand-written. A few
worth knowing when exploring the demo data:

| Agent | Action | Context | Result |
|---|---|---|---|
| Sales Agent | `crm.contact.read` | — | `ALLOW` (baseline) |
| Sales Agent | `crm.export` | — | `BLOCK` (baseline + policy both block it) |
| Sales Agent | `customer.delete` | — | `BLOCK` (no baseline permission at all — the org-wide policy is the only thing that applies) |
| Finance Agent | `refund.issue` | `amount: 250` | `REQUIRE_APPROVAL` (baseline alone) |
| Finance Agent | `refund.issue` | `amount: 1250` | `REQUIRE_APPROVAL` (baseline *and* "Refunds above $500") |
| Deployment Agent | `deployment.execute` | `environment: PRODUCTION` | `REQUIRE_APPROVAL` ("Production deployments" policy) |
| Research Agent | `web.execute_script` | — | `BLOCK` (nothing configured — default-closed) |

Run `npm run db:seed` to regenerate this history, or use `/policies/test` in
the app to try your own scenarios interactively.
