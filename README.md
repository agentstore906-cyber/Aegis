# Aegis

**The control plane for AI agents.**

Aegis gives companies running AI agents in production a single place to see what
those agents do, understand what they can access, and stay in control as the
AI workforce grows.

This repository covers **Phase 1** (marketing site, authentication,
multi-tenant organizations, the Agents / Activity product surface),
**Phase 2** (the policy engine: agent permissions, conditional policies,
the policy tester, and evaluation history), **Phase 3** (human approvals
for `REQUIRE_APPROVAL` decisions, and an append-only audit trail),
**Phase 4** (a versioned public API, organization-scoped API keys, and
`@aegis/agent-sdk` — a real external agent process can now authenticate,
report activity, and ask Aegis for a decision before acting), and
**Phase 5** (behavioral security alerts, cost intelligence, expanded RBAC
with a `FINANCE` role, member management, teams, retention settings, and
outbound webhooks). See [Roadmap](#roadmap) for what's next.

> **The core story today**: See every action. Control every permission.
> Approve sensitive decisions. Detect risky behavior. Track every AI
> dollar. Audit everything.

## Architecture

- **Framework**: Next.js 16 (App Router, Turbopack, Server Components by default)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, hand-built UI primitives (no component library)
- **Database**: PostgreSQL via Prisma 6
- **Auth**: Auth.js (NextAuth v5), credentials provider with bcrypt, JWT sessions,
  Prisma adapter (ready for OAuth providers later)
- **Validation**: Zod, enforced server-side on every mutation
- **Testing**: Vitest — decision logic, real-DB integration tests, and the
  SDK's own mocked-HTTP suite
- **SDK**: `@aegis/agent-sdk`, a zero-dependency TypeScript package in
  `packages/agent-sdk`, linked via npm workspaces

### Project layout

```
app/
  (marketing)/        Public site: home, pricing, contact (lead capture),
                        trust (incl. responsible disclosure), docs
  (auth)/              Sign in, sign up
  (dashboard)/          Authenticated app: overview, agents, activity,
                          policies, approvals, audit, developers, security,
                          costs, settings/organization, integrations
  admin/                Platform-internal only (see lib/admin) —
                          leads/ (Phase 8 lead dashboard)
  invitations/[token]/    Accept-invitation page (outside the dashboard group —
                          reachable by a signed-in OR signed-out user)
  onboarding/            Create-organization flow
  api/auth/               NextAuth route handler
  api/v1/                 Public API — see docs/api.md
    events/, evaluate/, approvals/[id]/, agents/register/
    __tests__/              Route-handler integration tests (real DB)

components/
  ui/                  Design system primitives (Button, Card, Table, ...)
  marketing/            Landing page sections
  dashboard/           Sidebar, topbar, shared dashboard UI, status badges
  agents/, activity/, auth/, onboarding/, policies/, approvals/, audit/,
  api-keys/, security/, costs/, settings/, webhooks/   Feature-specific components

lib/
  auth/                NextAuth config, session helpers, password hashing
  organizations/        Multi-tenancy queries + the central authorization guard
                        + members.ts (role changes, removal, privilege-escalation
                          guards) + invitations.ts (link-based, no email provider)
  rbac/                The central role → capability map — see docs/rbac.md
    capabilities.ts       CAPABILITIES, hasCapability(), capabilitiesFor()
  agents/, activity/    Domain queries and Server Actions
  policies/            The policy engine — see docs/policy-engine.md
    types.ts             Shared types (PolicyEvaluationInput/Result, ...)
    conditions.ts        Safe field resolution + operator evaluation, no eval
    matcher.ts            Scope/wildcard matching, permission resolution
    resolver.ts           Decision precedence + reason generation
    evaluate.ts            evaluateAgentAction() — creates an ApprovalRequest
                            + AuditEvent when it resolves to REQUIRE_APPROVAL,
                            and runs the security detectors afterward
    repository.ts          Prisma access, always organization-scoped
    authorization.ts       Role checks, delegating to lib/rbac
    describe.ts            Natural-language policy summaries
    safe-context.ts         Sanitizes untrusted JSON (size/depth/proto-pollution)
    actions.ts              Server Actions wiring validation + auth + repository
    __tests__/               Vitest suite for the pure decision logic
  approvals/           Human-in-the-loop workflow — see docs/approvals-and-audit.md
    authorization.ts      canViewApprovals / canResolveApproval
    repository.ts          Prisma access, idempotent request creation, lazy expiry
    service.ts              resolveApproval() — the race-safe approve/reject core,
                            fires an approval.* webhook on resolution
    actions.ts               Server Actions wrapping service.ts with auth checks
    __tests__/                Unit + real-DB integration tests
  audit/               Append-only audit trail — see docs/approvals-and-audit.md
    types.ts              AUDIT_EVENT_TYPES
    service.ts              recordAuditEvent() — the one write path into AuditEvent
    repository.ts            Filtered/paginated reads
  api-keys/            API key issuance & authentication — see docs/api.md
    crypto.ts              Key generation + SHA-256 hashing (not bcrypt — see docs/api.md)
    authorization.ts        canManageApiKeys, delegating to lib/rbac
    repository.ts            Prisma access, org-scoped
    service.ts                authenticateApiKey() — the Bearer-token auth path
    actions.ts                 Server Actions for the dashboard's key management UI
  security/            Behavioral security alerts — see docs/security-intelligence.md
    types.ts              SECURITY_ALERT_TYPES, Finding, severity-rule doc comment
    detectors.ts            Pure, DB-free detector functions (unit-testable, reused by prisma/seed.ts)
    evaluate.ts              runSecurityDetectors() — the orchestrator called after every
                            policy evaluation and every ingested activity event
    repository.ts            upsertAlertFinding() (24h dedup), acknowledge/resolve,
                            fires security.alert.* / cost.anomaly.detected webhooks
    redact.ts                 redactSecrets() — masks credential-shaped JSON keys
    __tests__/                 Unit (detectors) + real-DB integration + authorization tests
  costs/               Cost intelligence — see docs/cost-intelligence.md
    queries.ts             Query-time SUM/groupBy aggregation over ActivityEvent —
                          no separate CostEvent table
    authorization.ts        canViewCosts, delegating to lib/rbac
    __tests__/                Real-DB aggregation/precision/isolation tests
  teams/               Lightweight per-agent grouping (no org-chart membership model)
  webhooks/            Outbound integration — see docs/webhooks.md
    crypto.ts              Secret generation + HMAC-SHA256 signing
    ssrf.ts                  assertSafeWebhookUrl() — DNS-resolved private-IP rejection
    dispatch.ts               dispatchWebhookEvent() — best-effort, bounded retries,
                             never throws into its caller
    repository.ts             CRUD; listWebhookEndpoints() structurally excludes secret
    __tests__/                 SSRF/signing unit tests + mocked-fetch dispatch tests
  csv/                 csv/export.ts — streaming, CSV-injection-safe export used by
                        the audit/security/costs export routes
  api/                 Shared plumbing every app/api/v1/* route composes
    handler.ts             withApiAuth() — auth, scope check, rate limit, logging, errors
    errors.ts               ApiError + the public error code list
    idempotency.ts           withIdempotency() — safe retries for mutating endpoints
    request.ts                Size-capped JSON body parsing
    logger.ts                  Structured per-request logging (never the raw key)
  rate-limit/          RateLimiter interface + InMemoryRateLimiter (Redis-swappable later)
  billing/             Plans, entitlements, Stripe — see docs/deployment.md#6
    plans.ts               PLANS — the one place plan limits/pricing are defined
    entitlements.ts          canCreateAgent/canInviteMember/... — server-enforced, not UI-only
    stripe.ts                 Lazy client; null (not a throw) when unconfigured
    actions.ts                 Checkout + billing-portal Server Actions
  leads/               Phase 8 — /contact's lead capture (not tenant-owned, no Organization yet)
    service.ts              submitLead() — honeypot, rate limit, per-email throttle, all pure/testable
    repository.ts             Prisma access
    actions.ts                 Server Action wiring (IP resolution via next/headers lives here, not service.ts)
    __tests__/                 Real-DB integration tests
  admin/               Phase 8 — platform-wide admin, distinct from any MemberRole
    authorization.ts        isPlatformAdmin() — env allowlist (PLATFORM_ADMIN_EMAILS), not a DB flag
    __tests__/                 Unit tests (mocked env, no DB)
  validation/           Zod schemas, shared across forms, Server Actions, and the public API
  env.ts                Startup env validation — fails fast on a missing required var
  db.ts, utils.ts, pricing.ts, dashboard-nav.ts, request-origin.ts

packages/
  agent-sdk/           @aegis/agent-sdk — npm workspace package, see its own README
    src/                  client.ts, http.ts, errors.ts, types.ts
    __tests__/              Mocked-fetch Vitest suite (npm run test:sdk)
    CHANGELOG.md            Semver history — 0.2.0 added optional cost fields

prisma/
  schema.prisma        Database schema
  seed.ts              Demo data generator (Northstar Labs) — runs real
                       evaluations and real detector functions through the
                       engine, not hand-faked rows

docs/
  policy-engine.md          Decision model, precedence, security assumptions
  approvals-and-audit.md    Approval flow, idempotency, race-safety, authorization
  api.md                    Every public endpoint: auth, request/response, error codes
  security-intelligence.md  Detector rules, severity table, dedup strategy
  cost-intelligence.md      Why no CostEvent table, aggregation approach, anomaly method
  rbac.md                   Capability table, privilege-escalation guards, invitations
  webhooks.md               SSRF protections, signing, delivery-log limitations
  retention.md              What's configurable today vs. actually enforced (nothing yet)
  deployment.md             Env vars, migrations, Stripe webhook setup, health checks
  launch-checklist.md       Honest checked/unchecked state of every launch surface
  customer-feedback.md      Deliberately empty log template for real customer feedback
  security/questionnaire.md Prepared, factual answers for a customer security review
  sales/                    Phase 8 — one-pager, demo script, objections, outreach,
                            target-account-template (deliberately unpopulated)
  customer-research/        Phase 8 — interview script, feature-prioritization framework
  gtm/                      Phase 8 — weekly-loop, content-strategy, founder-sales,
                            competitive-research (deliberately unpopulated)
```

### Multi-tenancy & security

- Every tenant-owned row (`Agent`, `ActivityEvent`, `OrganizationMember`, ...)
  carries an `organizationId`.
- `lib/organizations/queries.ts` is the single place that resolves "which
  organization is the current request allowed to see" — it always checks the
  authenticated user's actual memberships, never a client-supplied ID.
- Dashboard routes are protected in two layers: `proxy.ts` (Next.js's
  middleware-equivalent) redirects unauthenticated requests before they reach
  a page, and `requireActiveOrganization()` re-verifies membership
  server-side on every dashboard layout render.
- Passwords are hashed with bcrypt (12 rounds); hashes are never sent to the
  client.
- All mutations (create agent, update agent, create organization, sign up)
  validate input with Zod on the server — never trust client-side validation
  alone.

### Structured activity events

`ActivityEvent` is the backbone the rest of the roadmap builds on. Frequently
filtered fields (`status`, `riskLevel`, `eventType`, `traceId`, `agentId`,
`timestamp`) are real indexed columns rather than JSON, so activity, cost, and
future policy/audit features can query them directly. Free-form detail lives
in a `metadata` JSON column. `traceId` / `parentEventId` already model the
event graph a future tracing view would need.

### Policy engine

Two layers feed every decision: **agent permissions** (the baseline — "what
is this agent generally allowed to do?") and **policies** (conditional rules
layered on top — "under these conditions, what should Aegis do?").

```
Agent action
    |
    v
Baseline permission  (exact/wildcard action + resource match)
    |
    v
Matching policies     (scope match + all conditions AND'd together)
    |
    v
Decision resolver     BLOCK beats REQUIRE_APPROVAL beats ALLOW,
    |                  regardless of priority
    v
ALLOW / REQUIRE_APPROVAL / BLOCK  (+ a deterministic, human-readable reason)
```

An action with no matching permission and no matching policy resolves to
`BLOCK` — the engine fails closed by default. Every evaluation is persisted
to `PolicyEvaluation` (with a linked `ActivityEvent`) so decisions are
auditable and explainable after the fact, not just in the moment. Full
design details, including why evaluations never hold a foreign key back to
the policy that produced them, live in
**[`docs/policy-engine.md`](docs/policy-engine.md)**.

### Approvals & audit trail

When `evaluateAgentAction` resolves to `REQUIRE_APPROVAL`, Aegis now
actually routes that decision to a human instead of just recording it: an
`ApprovalRequest` is created in the same transaction as the evaluation, an
authorized member (`OWNER`/`ADMIN`/`SECURITY`) reviews it at `/approvals`,
and their `APPROVE`/`REJECT` decision — with an optional comment — is
stored as an immutable `ApprovalDecision`. Resolution is race-safe against
two people acting on the same request at once, and every step (request
created, approved, rejected, expired) plus every policy/permission/agent
mutation lands in an append-only `AuditEvent` trail at `/audit`. Full
design details — idempotency strategy, why the resolution transaction never
throws mid-flight, expiration, and authorization — live in
**[`docs/approvals-and-audit.md`](docs/approvals-and-audit.md)**.

Aegis does not yet resume the external agent's execution after an approval
— see [Public API & SDK](#public-api--sdk) below for how far that goes
today. An approved request's detail page says "Approved — ready for
execution," not that execution happened.

### Public API & SDK

A real external agent process — not a signed-in browser session — can now
authenticate with an organization-scoped API key and call a versioned
public API (`app/api/v1/*`, see [`docs/api.md`](docs/api.md)) to report
activity (`POST /events`), ask for a policy decision
(`POST /evaluate` — a thin wrapper around the same `evaluateAgentAction`
described above, unmodified), and poll an approval it triggered
(`GET /approvals/:id`). `@aegis/agent-sdk` (`packages/agent-sdk`) wraps
this in a small TypeScript client:

```ts
import { Aegis } from "@aegis/agent-sdk";

const aegis = new Aegis({ apiKey: process.env.AEGIS_API_KEY!, baseUrl: process.env.AEGIS_BASE_URL! });

const auth = await aegis.authorize({ agent: "finance-agent", action: "refund.issue", context: { amount: 1250 } });

if (auth.decision === "REQUIRE_APPROVAL") {
  const approval = await aegis.waitForApproval({ approvalRequestId: auth.approvalRequestId });
  if (approval.status !== "APPROVED") throw new Error("Not approved");
}
```

Requests are authenticated by hashing the presented key with SHA-256 and
looking it up by that hash (raw keys are never stored — see
[`docs/api.md`](docs/api.md) for why a fast hash is the right choice here,
unlike the bcrypt used for user passwords), rate-limited per key, and
support an `Idempotency-Key` header so a retried mutation can't
double-create an activity event or approval request. The SDK never
executes a tool on your behalf — it only reports Aegis's decision; your
own code decides what to do with it.

**Never expose an API key in a browser.** This API and SDK are for
server-side agent runtimes only — a key shipped to client-side JavaScript
is a key anyone viewing your page's source can extract and use to act as
your organization.

### Security intelligence

Every ingested activity event and policy evaluation runs through a small
set of deterministic, explainable detectors — not a black-box ML model —
in `lib/security/detectors.ts`: a first-ever high-risk action, a burst of
blocked actions, a repeated-failure loop, an unfamiliar tool, a burst of
high-risk actions, and a cost spike (see below). Each finding becomes a
`SecurityAlert` with a severity, a plain-language title/description, and
structured evidence — deduplicated against any `OPEN` alert of the same
`(agent, type)` from the last 24 hours rather than spamming a new row per
occurrence. Review and resolve them at `/security`; full rule definitions
and the severity table live in
**[`docs/security-intelligence.md`](docs/security-intelligence.md)**.

### Cost intelligence

`/costs` aggregates the `costCents` (and optional `inputTokens`/
`outputTokens`/`taskId`/`taskType`) already carried on every `ActivityEvent`
— there is no separate cost event store to keep in sync. Spend is broken
down by agent, provider, model, task type, and team, with month-over-month
change and a cost-per-successful-task metric that only appears once an
agent actually tags its events with a `taskId`. A cost spike (today's spend
≥ 3× an agent's trailing daily average, above a $1 floor) is just another
security detector finding — `/costs`' "Cost anomalies" section is the same
`SecurityAlert` data filtered by type, not a second system. Details in
**[`docs/cost-intelligence.md`](docs/cost-intelligence.md)**.

### Enterprise controls: RBAC, teams, retention, SSO placeholder

`lib/rbac/capabilities.ts` is the single source of truth for what each of
the six roles (`OWNER`, `ADMIN`, `ENGINEER`, `SECURITY`, `FINANCE`,
`VIEWER`) can do — every domain's `authorization.ts` delegates to
`hasCapability()` rather than comparing roles inline. Owners and admins
manage members from `/settings/organization`: invite (generates a
copyable `/invitations/:token` link — **no email is sent**, there is no
mail provider in this codebase), change role, and remove, with
server-side guards that make privilege escalation and a zero-`OWNER`
organization both impossible. Agents can optionally belong to a `Team`
for grouping cost/activity views. Retention day-counts are configurable
per data type but **not enforced** — no scheduler exists in this
environment to delete anything on a schedule, and the settings UI says so
explicitly rather than implying otherwise. SSO is schema + a "not yet
available" placeholder card, not a real SAML/OIDC integration. Full
details in **[`docs/rbac.md`](docs/rbac.md)** and
**[`docs/retention.md`](docs/retention.md)**.

### Integrations & webhooks

`/integrations` lets you create outbound webhook endpoints — one generic,
HMAC-signed integration rather than bespoke Slack/Teams/PagerDuty
connectors, since a generic webhook can feed any of them. Endpoints
subscribe to specific events (`security.alert.created`,
`approval.requested`, `cost.anomaly.detected`, `agent.paused`, ...); each
delivery is SSRF-checked (both at creation and immediately before send —
DNS answers can change), signed with a per-endpoint secret shown once,
and retried a bounded number of times on network error or 5xx only.
Delivery is best-effort and inline, not a durable queue — there's no
background-job infrastructure in this environment to build one on top of,
and a dispatch call can never fail the flow that triggered it. Every
attempt is logged to `WebhookDelivery` so gaps are visible even though
they aren't recovered. Details in
**[`docs/webhooks.md`](docs/webhooks.md)**.

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Set `DATABASE_URL` to a PostgreSQL connection string, and generate an
`AUTH_SECRET`:

```bash
openssl rand -base64 32
```

**Getting a Postgres database.** Any of these work:

- **Docker**: `docker run -d --name aegis-db -e POSTGRES_USER=aegis -e POSTGRES_PASSWORD=aegis -e POSTGRES_DB=aegis -p 5432:5432 postgres:16`
- **WSL**: install Ubuntu (`wsl --install -d Ubuntu`), then `sudo apt install postgresql`
- **Hosted**: [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app) all have a free Postgres tier — copy the connection string they give you into `DATABASE_URL`

### 3. Create the database schema

```bash
npm run db:push      # push the schema (fastest way to get started)
# or
npm run db:migrate   # create a tracked migration
```

### 4. Seed demo data

```bash
npm run db:seed
```

This creates the **Northstar Labs** organization with six demo agents (Sales,
Support, Finance, Research, Coding, Deployment) grouped into three teams
(Revenue, Platform, Finance — Research Agent is deliberately left
team-less), realistic structured activity events, baseline permissions per
agent, four org-wide policies, a policy evaluation history generated by
actually running those scenarios through the real engine, a handful of
approval requests (pending, approved, and rejected) resolved by a second
demo user, and two real security-alert scenarios computed by running the
actual detector functions (not hand-faked JSON): a backdated 7-day ~$12/day
baseline for Research Agent followed by a ~$94 spend day that trips
`detectCostSpike`, and a first-ever blocked `crm.export` action for Sales
Agent that trips `detectNewSensitiveAction` at `CRITICAL` (acknowledged,
not resolved, so the Acknowledged state has a real example). Sign in with:

```
demo@northstarlabs.io / aegis-demo-2026          (Owner)
sarah.chen@northstarlabs.io / aegis-demo-2026    (Admin — the demo approver)
priya.patel@northstarlabs.io / aegis-demo-2026   (Security — acknowledges the crm.export alert)
marcus.webb@northstarlabs.io / aegis-demo-2026   (Finance — cost + audit visibility only)
```

### 5. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000`.

### 6. Try the public API (optional)

Sign in, create an API key at **Developers → API Keys** (or follow
**Developers → Quickstart** in the app, which walks through this with the
running app's own base URL pre-filled), then:

```bash
npm install @aegis/agent-sdk   # already available locally via the npm workspace — no publish needed
```

```ts
import { Aegis } from "@aegis/agent-sdk";

const aegis = new Aegis({ apiKey: "aegis_live_...", baseUrl: "http://localhost:3000" });
await aegis.track({ agent: "sales-agent", eventType: "TOOL_CALL", action: "crm.contact.read" });
```

`packages/agent-sdk` is an npm workspace (`npm install` at the repo root
already links it) — you don't need to publish it to try it locally.

## Development commands

| Command             | Purpose                                  |
| ------------------- | ----------------------------------------- |
| `npm run dev`        | Start the dev server (Turbopack)          |
| `npm run build`       | Production build                          |
| `npm run start`      | Run the production build                  |
| `npm run lint`       | ESLint                                    |
| `npm run db:push`     | Push `schema.prisma` to the database      |
| `npm run db:migrate`  | Create/apply a tracked migration          |
| `npm run db:seed`    | Seed demo data                            |
| `npm run db:studio`  | Open Prisma Studio                        |
| `npm test`           | Run the app's Vitest suite (policy engine, approvals, API keys, public API routes) |
| `npm run build:sdk`  | Build `@aegis/agent-sdk` (`tsc` → `dist/` with declarations) |
| `npm run test:sdk`   | Run the SDK's own Vitest suite (mocked HTTP, no DB) |

## Environment variables

| Variable        | Required | Description                                 |
| ---------------- | -------- | -------------------------------------------- |
| `DATABASE_URL`    | Yes      | PostgreSQL connection string                |
| `AUTH_SECRET`     | Yes      | Signs session JWTs — must be a random secret |
| `AUTH_URL`        | Prod only | Public base URL of the deployment           |
| `PLATFORM_ADMIN_EMAILS` | Optional | Comma-separated allowlist for `/admin/leads` (Phase 8) — unset means nobody can reach it |

None of the above are new in Phase 4 — the public API needs no server-side
configuration beyond what already exists (API keys are created and stored
via the dashboard, not an env var). `AEGIS_API_KEY` / `AEGIS_BASE_URL` in
the snippets above are conventions for **your own agent process's**
environment, not this repository's.

## Phase 1 + 2 + 3 + 4 + 5 + 6 capabilities

- Marketing site (hero, problem, control plane, activity/policies/approvals/
  security/cost previews, pricing)
- Email + password authentication, secure sessions, protected routes
- Organization creation and membership (multi-tenant from day one)
- Agents: list with search/filters/pagination, create, edit, pause/resume,
  detail view with tabs (including an Approvals tab)
- Activity: structured, filterable, paginated event log with a detail view
- **Agent permissions**: baseline `ALLOW`/`REQUIRE_APPROVAL`/`BLOCK` rules
  per agent+action(+resource), managed from the Agent Detail Permissions tab
- **Policies**: conditional org-wide or per-agent rules with a scope +
  condition builder, enable/disable, priority, and a live natural-language
  preview
- **Policy tester**: evaluate any action through the real engine and see the
  full decision trace before wiring anything up
- **Evaluation history**: every decision the engine has made, filterable,
  with a detail view showing the matched permission/policies and full
  context
- **Approvals**: `REQUIRE_APPROVAL` evaluations become real, resolvable
  requests at `/approvals` — filterable list (pending-first by default), a
  full review detail view (context, matched policy, trace, related
  activity, agent history), and a race-safe Approve/Reject flow with an
  optional comment, restricted to `OWNER`/`ADMIN`/`SECURITY`
- **Audit trail**: an append-only, filterable log at `/audit` of every
  policy/permission/agent mutation and every approval state change, with a
  detail view and structured metadata
- **API keys**: organization-scoped, SHA-256-hashed credentials managed at
  `/developers/api-keys` — create, name, set an optional expiration, revoke
  (immediate), raw value shown exactly once
- **Public API** (`/api/v1/*`, versioned): event ingestion, policy
  evaluation, approval status polling, and optional agent auto-registration
  — rate-limited per key, `Idempotency-Key`-safe, uniform error codes,
  never leaks a stack trace
- **`@aegis/agent-sdk`**: a zero-dependency TypeScript client (`track`,
  `authorize`, `waitForApproval`, `registerAgent`) with typed errors,
  bounded retry/backoff, and a discriminated-union decision result
- **Developers hub**: `/developers` (base URL + links),
  `/developers/api-keys`, `/developers/quickstart` (10-step walkthrough
  with copyable, pre-filled code)
- **Security alerts**: six deterministic, explainable detectors (new
  sensitive action, block spike, failure loop, new tool usage, high-risk
  burst, cost spike) at `/security`, deduplicated per `(agent, type)` over
  a 24h window, with Acknowledge/Resolve, a "create policy from this
  alert" deep link, and a working "pause agent" action
- **Cost intelligence**: `/costs` — spend by agent/provider/model/task
  type/team, month-over-month change, cost-per-successful-task, and a
  cost-anomaly list backed by the same alert system above
- **Advanced RBAC**: a central `hasCapability()` map covering six roles
  (added `FINANCE`); member invitations (link-based, no email sent), role
  changes, and removal, all with privilege-escalation and
  last-owner guards
- **Teams**: lightweight per-agent grouping for cost/activity views
- **Retention settings**: per-data-type day-count configuration —
  explicitly not enforced yet (no scheduler in this environment)
- **SSO placeholder**: schema + settings-card only, clearly labeled as not
  yet available — no real SAML/OIDC
- **Integrations**: one generic, HMAC-signed, SSRF-protected outbound
  webhook integration at `/integrations`, with bounded retries and a
  per-endpoint delivery log
- **CSV export**: streamed (not memory-loaded), CSV-injection-safe exports
  for Audit, Security, and Costs (Audit export additionally gated by plan,
  see Billing below)
- Fully responsive, accessible (keyboard nav, focus states, semantic HTML),
  with loading/empty/error states throughout
- **Billing**: a central plan config (`lib/billing/plans.ts` —
  Free/Startup/Growth/Business/Enterprise) enforced server-side
  (`lib/billing/entitlements.ts`) against agent/member/API-key creation,
  webhook creation, and audit export — never UI-only; `/settings/billing`
  shows real usage against real limits. Real Stripe Checkout + customer
  portal + signature-verified, idempotent webhook handling
  (`app/api/webhooks/stripe/route.ts`), gated behind `STRIPE_SECRET_KEY`
  being configured — the app runs fully without it, showing an honest
  "not configured" state instead of a fake button.
- **Production hardening (Phase 6)**: security headers (CSP, HSTS in
  production, frame protection), startup environment validation
  (`lib/env.ts`), a `/api/health` endpoint, secret redaction extended to
  every persistence point that stores caller-supplied JSON (previously
  only 2 of 6), every user-initiated mutation's audit event now commits
  atomically with the mutation itself (previously a separate, non-atomic
  write), and a real end-to-end test covering signup → policy → evaluate
  → approve → audit trail.

## Roadmap

**Phase 7 — Launch readiness & customer validation** shipped the
public-facing surface a real prospect or developer needs to evaluate and
trust Aegis before adopting it: SEO fundamentals (`metadataBase`, Open
Graph/Twitter metadata, a generated favicon and OG image, `robots.ts`,
`sitemap.ts`), draft legal pages (`/privacy`, `/terms`), a public
Trust & Security page (`/trust`), a public documentation hub (`/docs`
and seven subpages covering policies, approvals, security, billing,
deployment, the API, and the SDK — content drawn from the real,
already-accurate `docs/*.md` files, not invented), a `/contact` page and
a dashboard feedback entry (both gated on a real, configurable contact
address — never a fake one), and expanded analytics event coverage for
the real activation funnel. Per Phase 7's own closing principle, this
phase deliberately did **not** add new product features, rebuild any
existing flow, or fabricate metrics/integrations/compliance claims — see
`docs/launch-checklist.md` and `docs/smoke-test.md` for the honest,
checkable state of what's ready.

**Phase 8 — go-to-market infrastructure** did not touch the product
surfaces above. It built what's needed to acquire and onboard real
customers: a real lead-capture flow at `/contact` (validated, honeypot +
rate-limited + per-email-throttled, persisted to a `Lead` model, not a
mailto link) with an Enterprise-specific CTA
(`/pricing` → `/contact?source=enterprise`), a platform-admin-only lead
dashboard at `/admin/leads` (gated by an env allowlist, distinct from any
`MemberRole` — see `lib/admin/authorization.ts`), a responsible-disclosure
section on `/trust`, and a full sales/GTM documentation set
(`docs/sales/`, `docs/customer-research/`, `docs/gtm/`,
`docs/security/questionnaire.md`) — grounded in what the product actually
does today, with account/testimonial/case-study templates left
deliberately unpopulated rather than filled with invented data. See
`AGENTS.md` for the full Phase 8 brief and its closing principle: after
this, the priority is real customer conversations, not another feature
phase.

**What's next is customer-driven, not roadmap-driven.** The next step is
real customer validation (5–10 companies, real usage, real feedback — see
`docs/customer-feedback.md`) before deciding what to build next, rather
than continuing to add features speculatively. The concrete technical
items already identified as real gaps, to prioritize based on what
actual customers hit first: verifying the Stripe integration against a
real test-mode account (this environment has none); a real channel back
to the external agent so an `APPROVED` decision can actually resume its
execution (today's SDK only polls); a scheduler/background-job runner,
so retention settings can actually delete data and webhook delivery can
move off "best-effort inline" onto a durable queue; scoped API keys (the
`scopes` column and per-endpoint `requireScope()` checks already exist,
see [`docs/api.md`](docs/api.md), but there's no key-creation scope
picker yet); and a real SSO/SAML integration to replace today's
placeholder.

## Known limitations

- This environment's PostgreSQL runs inside a WSL Ubuntu instance
  (installed during setup) rather than natively on Windows. WSL2 shuts its
  VM down a few seconds after the last `wsl` session closes, which stops
  Postgres with it. If `npm run dev` can't reach the database after a
  reboot or a period of inactivity, run `wsl -d Ubuntu -u root service
  postgresql start` (or just `wsl` to open a session) to bring it back up
  before starting the app. For a setup that doesn't need this step, use
  Docker or a hosted provider instead (see [Local setup](#local-setup)).
- **Billing (Phase 6) is real, but only verified without a live Stripe
  account.** Plans/entitlements (`lib/billing/plans.ts`,
  `lib/billing/entitlements.ts`) are enforced server-side against every
  agent/member/API-key creation and audit export, not just displayed —
  and the Stripe integration (`lib/billing/stripe.ts`,
  `app/api/webhooks/stripe/route.ts`) is real, working code with
  signature verification and idempotency covered by tests using
  synthetic Stripe events. What's **not** verified here: an actual
  checkout → webhook → entitlement-unlock round trip against a real
  Stripe test-mode account, since this environment has no Stripe
  credentials. See [`docs/deployment.md`](docs/deployment.md#6-stripe-webhook-configuration).
- OAuth providers are not wired up; the schema and NextAuth config are ready
  for them.
- The public API's rate limiter (`lib/rate-limit/limiter.ts`) is an
  in-process counter — correct for a single instance, but a multi-instance
  deployment would let each instance independently allow up to the limit.
  The `RateLimiter` interface is designed so a Redis-backed implementation
  is a drop-in swap later.
- API keys have no scope-picker UI yet; every key is created with the full
  default scope set (see [`docs/api.md`](docs/api.md#scopes)).
- **Retention settings are configuration only.** `activityRetentionDays`
  etc. are stored and shown in the UI, but nothing deletes data on a
  schedule — there's no scheduler/background-job runner in this
  environment. See [`docs/retention.md`](docs/retention.md).
- **SSO is a placeholder**, not a real integration — `Organization.ssoEnabled`
  / `.ssoProvider` and a settings card exist so the shape is there, but no
  SAML/OIDC flow is implemented. See [`docs/rbac.md`](docs/rbac.md).
- **Webhook delivery is best-effort, not a durable queue.** A dropped
  delivery during a process restart is lost (though logged as a gap in
  `WebhookDelivery`, not silently) — there's no background-job
  infrastructure to build a real queue on top of yet. See
  [`docs/webhooks.md`](docs/webhooks.md).
- **Member invitations don't send email.** There's no mail provider in
  this codebase; inviting someone generates a link the inviter has to
  copy and share themselves.
- **Legal pages are drafts, not counsel-reviewed.** `/privacy` and
  `/terms` (Phase 7) describe what the product actually does today in
  plain language, clearly labeled "pending legal review" — they are not
  a substitute for a real legal review before commercial launch.
- **Contact and in-app feedback require configuration.** `/contact` and
  the dashboard's "Send feedback" menu item both read
  `NEXT_PUBLIC_CONTACT_EMAIL`; unset, they show an honest "not
  configured" state rather than a fake address.
