# Aegis

**The control plane for AI agents.**

Aegis gives companies running AI agents in production a single place to see what
those agents do, understand what they can access, and stay in control as the
AI workforce grows.

This repository is the **Phase 1 foundation**: marketing site, authentication,
multi-tenant organizations, and the core Agents / Activity product surface.
Policies, approvals, cost intelligence, and security monitoring are designed
for architecturally, but not yet implemented — see [Roadmap](#roadmap).

## Architecture

- **Framework**: Next.js 16 (App Router, Turbopack, Server Components by default)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, hand-built UI primitives (no component library)
- **Database**: PostgreSQL via Prisma 6
- **Auth**: Auth.js (NextAuth v5), credentials provider with bcrypt, JWT sessions,
  Prisma adapter (ready for OAuth providers later)
- **Validation**: Zod, enforced server-side on every mutation

### Project layout

```
app/
  (marketing)/        Public site: home, pricing
  (auth)/              Sign in, sign up
  (dashboard)/          Authenticated app: overview, agents, activity
  onboarding/            Create-organization flow
  api/auth/               NextAuth route handler

components/
  ui/                  Design system primitives (Button, Card, Table, ...)
  marketing/            Landing page sections
  dashboard/           Sidebar, topbar, shared dashboard UI
  agents/, activity/, auth/, onboarding/  Feature-specific components

lib/
  auth/                NextAuth config, session helpers, password hashing
  organizations/        Multi-tenancy queries + the central authorization guard
  agents/, activity/    Domain queries and Server Actions
  validation/           Zod schemas, shared across forms and Server Actions
  db.ts, utils.ts, pricing.ts, dashboard-nav.ts

prisma/
  schema.prisma        Database schema
  seed.ts              Demo data generator (Northstar Labs)
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
Support, Finance, Research, Coding, Deployment) and realistic structured
activity events. Sign in with:

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

## Environment variables

| Variable        | Required | Description                                 |
| ---------------- | -------- | -------------------------------------------- |
| `DATABASE_URL`    | Yes      | PostgreSQL connection string                |
| `AUTH_SECRET`     | Yes      | Signs session JWTs — must be a random secret |
| `AUTH_URL`        | Prod only | Public base URL of the deployment           |

## Phase 1 capabilities

- Marketing site (hero, problem, control plane, activity/policies/approvals/
  security/cost previews, pricing)
- Email + password authentication, secure sessions, protected routes
- Organization creation and membership (multi-tenant from day one)
- Agents: list with search/filters/pagination, create, edit, pause/resume,
  detail view with tabs
- Activity: structured, filterable, paginated event log with a detail view
- Fully responsive, accessible (keyboard nav, focus states, semantic HTML),
  with loading/empty/error states throughout

Policies, Approvals, Security monitoring, and Cost intelligence are marketed
on the landing page as **previews** with an explicit "coming next" label —
their UI is not present inside the authenticated app, so there is nothing
that looks functional but isn't.

## Roadmap

- **Phase 2 — Policy Engine & Agent Permissions**: turn the `ALLOWED` /
  `BLOCKED` / `APPROVAL_REQUIRED` states already in `ActivityEvent` into
  something a policy actually decides, plus per-agent permission scopes.
- **Phase 3 — Approvals & Audit**: human-in-the-loop approval workflow for
  `APPROVAL_REQUIRED` events, and an immutable audit trail.
- **Phase 4 — API keys & Ingestion**: hashed API keys, an ingestion API, and
  the `@aegis/agent-sdk` package so real agents can report activity and ask
  Aegis for an authorization decision.
- **Phase 5 — Cost Intelligence & Security Monitoring**: anomaly detection,
  per-model/per-task cost attribution, advanced RBAC, integrations.

## Known limitations

- No live PostgreSQL instance is provisioned in this environment — schema,
  client generation, and type-checking were all validated, but
  migration/seed execution needs a `DATABASE_URL` you provide (see step 2
  above).
- Billing is not implemented; pricing is presentational only
  (`lib/pricing.ts`).
- OAuth providers are not wired up; the schema and NextAuth config are ready
  for them.
