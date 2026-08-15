# Sales objections — honest answers

Answer technically honestly. If the true answer is "we don't do that yet,"
say so — a prospect who catches an overclaim in the demo won't trust the
next answer either.

## "Why can't we build this ourselves?"

You can — it's a policy engine, an approval queue, and an audit log. Teams
do build a first version of this internally, usually per-agent and
ad hoc. What they're buying by not building it: a policy engine that
already handles precedence correctly (`BLOCK` > `REQUIRE_APPROVAL` >
`ALLOW`, fails closed by default), race-safe approval resolution, an
audit trail that's actually append-only, and RBAC that doesn't get
bolted on after the third incident. The honest pitch is time-to-governance,
not "impossible to build."

## "Does Aegis replace our AI observability?"

No. Observability tools (tracing, evals, latency/quality monitoring) tell
you how the model performed. Aegis tells you what the agent was *allowed*
to do and *did* do, and puts a human in the loop for sensitive actions.
Different question. They compose — Activity events carry `traceId` so you
can correlate.

## "Does Aegis replace our IAM?"

No. IAM controls who can access what system. Aegis controls what an
*agent*, once it has that access, is allowed to actually do with it,
action by action, with conditional policy and human approval. Aegis
doesn't manage your cloud IAM roles or SSO — SSO is schema + a "not
available yet" placeholder in this product today, not a real
SAML/OIDC integration.

## "Does Aegis execute agents?"

No, and this is a firm boundary, not a current limitation. Aegis
evaluates and decides; your agent's own code (via the SDK or API) decides
what to do with that decision. Aegis never calls your tools, your model
provider, or your infrastructure on your behalf.

## "Where does Aegis sit in our architecture?"

Between your agent process and the action it's about to take. Your agent
calls `aegis.authorize(...)` before acting; if the answer is
`REQUIRE_APPROVAL`, it calls `aegis.waitForApproval(...)`. Aegis is a
control layer your agent calls into, not a proxy that intercepts traffic
transparently — see `docs/api.md`.

## "Does it work with OpenAI? Anthropic?"

Aegis is model-provider-agnostic — it never calls a model itself. It works
with any agent runtime that can make an HTTP call via the API or SDK,
regardless of which model provider is behind it.

## "Can we use custom agents?"

Yes — that's the primary path today. Any server-side process that can
call the public API (`app/api/v1/*`) or use `@aegis/agent-sdk` works.

## "Do you have native LangGraph / CrewAI / AutoGen integrations?"

Not today. Be direct about this: **there are no framework-specific
integrations yet** — connect through the API/SDK from within your
framework's tool/action layer, the same way you'd call any other external
service. Don't imply a native integration exists; see `AGENTS.md` §36.

## "What happens if Aegis is unavailable?"

Your agent's `authorize()` call fails (the SDK has bounded retry/backoff,
then throws). What happens next is your code's decision — fail closed
(don't act) or fail open (act anyway), Aegis doesn't impose one. Today
there's no multi-region failover or SLA-backed uptime commitment on this
product; be upfront about that with anyone asking about mission-critical
reliability requirements.

## "How is this different from logging?"

Logging is passive — it tells you what happened after the fact. Aegis is
in the decision path *before* the action happens: it can require a human
to approve it, or block it outright. The audit trail is a byproduct of
that, not the whole product.

## "How does Aegis handle sensitive actions?"

Three layers: (1) baseline permission on the agent — is this action
allowed at all; (2) conditional policies — under what conditions does it
need approval or get blocked (e.g. refund amount, environment); (3)
deterministic security detectors that flag unusual behavior after the
fact (first-ever sensitive action, burst of blocks, repeated failures,
new tool usage, high-risk burst, cost spike) — not a black-box risk score.

## "Is this SOC 2 / ISO 27001 certified?"

No certifications exist for this product today. Don't claim any. Point to
`/trust` and `docs/security/questionnaire.md` for what's actually true
about the architecture, and mark anything genuinely unknown as
"requires deployment/customer configuration" rather than guessing.
