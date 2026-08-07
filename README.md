# Aegis

**The control plane for AI agents.**

Aegis gives companies running AI agents in production a single place to see what
those agents do, understand what they can access, and stay in control as the
AI workforce grows.

This repository covers **Phase 1** (marketing site, authentication,
multi-tenant organizations, the Agents / Activity product surface) and
**Phase 2** (the policy engine: agent permissions, conditional policies,
the policy tester, and evaluation history). Approvals, an immutable audit
trail, cost intelligence, and security monitoring are designed for
architecturally, but not yet implemented — see [Roadmap](#roadmap).

## Architecture

- **Framework**: Next.js 16 (App Router, Turbopack, Server Components by default)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, hand-built UI primitives (no component library)
- **Database**: PostgreSQL via Prisma 6
- **Auth**: Auth.js (NextAuth v5), credentials provider with bcrypt, JWT sessions,
  Prisma adapter (ready for OAuth providers later)
- **Validation**: Zod, enforced server-side on every mutation
- **Testing**: Vitest for the policy engine's decision logic

### Project layout

```
app/
  (marketing)/        Public site: home, pricing
  (auth)/              Sign in, sign up
  (dashboard)/          Authenticated app: overview, agents, activity, policies
  onboarding/            Create-organization flow
  api/auth/               NextAuth route handler

components/
  ui/                  Design system primitives (Button, Card, Table, ...)
  marketing/            Landing page sections
  dashboard/           Sidebar, topbar, shared dashboard UI
  agents/, activity/, auth/, onboarding/, policies/  Feature-specific components

lib/
  auth/                NextAuth config, session helpers, password hashing
  organizations/        Multi-tenancy queries + the central authorization guard
  agents/, activity/    Domain queries and Server Actions
  policies/            The policy engine — see docs/policy-engine.md
    types.ts             Shared types (PolicyEvaluationInput/Result, ...)
    conditions.ts        Safe field resolution + operator evaluation, no eval
    matcher.ts            Scope/wildcard matching, permission resolution
    resolver.ts           Decision precedence + reason generation
    evaluate.ts            evaluateAgentAction() — the engine's one entry point
    repository.ts          Prisma access, always organization-scoped
    authorization.ts       Role checks (canManagePolicies, ...)
    describe.ts            Natural-language policy summaries
    safe-context.ts         Sanitizes untrusted JSON (size/depth/proto-pollution)
    actions.ts              Server Actions wiring validation + auth + repository
    __tests__/               Vitest suite for the pure decision logic
  validation/           Zod schemas, shared across forms and Server Actions
  db.ts, utils.ts, pricing.ts, dashboard-nav.ts

prisma/
  schema.prisma        Database schema
  seed.ts              Demo data generator (Northstar Labs) — runs real
                       evaluations through the engine, not hand-faked ones

docs/
  policy-engine.md     Decision model, precedence, security assumptions
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

Phase 3 will add the actual approval workflow — a human reviewing and
resolving `REQUIRE_APPROVAL` evaluations. Phase 2 evaluates and records that
decision; it doesn't yet route it to anyone.

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
Support, Finance, Research, Coding, Deployment), realistic structured
activity events, baseline permissions per agent, four org-wide policies, and
a policy evaluation history generated by actually running those scenarios
through the real engine. Sign in with:

```
demo@northstarlabs.io / aegis-demo-2026
```

### 5. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000`.

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
| `npm test`           | Run the policy engine's Vitest suite      |

## Environment variables

| Variable        | Required | Description                                 |
| ---------------- | -------- | -------------------------------------------- |
| `DATABASE_URL`    | Yes      | PostgreSQL connection string                |
| `AUTH_SECRET`     | Yes      | Signs session JWTs — must be a random secret |
| `AUTH_URL`        | Prod only | Public base URL of the deployment           |

## Phase 1 + 2 capabilities

- Marketing site (hero, problem, control plane, activity/policies/approvals/
  security/cost previews, pricing)
- Email + password authentication, secure sessions, protected routes
- Organization creation and membership (multi-tenant from day one)
- Agents: list with search/filters/pagination, create, edit, pause/resume,
  detail view with tabs
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
- Fully responsive, accessible (keyboard nav, focus states, semantic HTML),
  with loading/empty/error states throughout

Approvals, Security monitoring, and Cost intelligence are marketed on the
landing page as **previews** with an explicit "coming next" label — their UI
is not present inside the authenticated app, so there is nothing that looks
functional but isn't.

## Roadmap

- **Phase 3 — Approvals & Audit**: human-in-the-loop approval workflow that
  acts on `REQUIRE_APPROVAL` evaluations (the engine already produces and
  records them — Phase 3 is routing and resolving), plus an immutable audit
  trail for permission/policy CRUD.
- **Phase 4 — API keys & Ingestion**: hashed API keys, an ingestion API, and
  the `@aegis/agent-sdk` package so real agents can report activity and ask
  Aegis for an authorization decision via `evaluateAgentAction`.
- **Phase 5 — Cost Intelligence & Security Monitoring**: anomaly detection,
  per-model/per-task cost attribution, advanced RBAC, integrations.

## Known limitations

- This environment's PostgreSQL runs inside a WSL Ubuntu instance
  (installed during setup) rather than natively on Windows. WSL2 shuts its
  VM down a few seconds after the last `wsl` session closes, which stops
  Postgres with it. If `npm run dev` can't reach the database after a
  reboot or a period of inactivity, run `wsl -d Ubuntu -u root service
  postgresql start` (or just `wsl` to open a session) to bring it back up
  before starting the app. For a setup that doesn't need this step, use
  Docker or a hosted provider instead (see [Local setup](#local-setup)).
- Billing is not implemented; pricing is presentational only
  (`lib/pricing.ts`).
- OAuth providers are not wired up; the schema and NextAuth config are ready
  for them.
