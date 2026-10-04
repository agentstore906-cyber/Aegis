# Aegis Free AI Agent Risk Scanner

> Status: implemented and verified locally (Oct 2026), **not deployed**. Phase 1 of the scanner roadmap
> (self-assessment). Migration `20261011120000_free_risk_scanner` is additive and has been applied only to
> the local test database; production gets it through `prisma migrate deploy` in `npm run build`.

The scanner is the first thing a visitor does in Aegis, before any account exists:

```
Homepage CTA → /scan (5 steps, ~60 s) → POST /api/scan → /scan/report/:id
   → "Connect your agent to Aegis" → sign-up / sign-in → dashboard claims the scan
   → /risk-scan/:id  ("Your Aegis security setup")  → /risk-scan (history, trend)
```

It is a **self-assessment of a described configuration**. It never connects to, tests or executes an agent,
and it says so. It is not a penetration test, and its output is worded as *indication of risk*, never as a
verdict that an agent is or is not secure.

## 1. Architecture

| Layer | Where | Notes |
|---|---|---|
| Vocabulary (allowlisted ids) | `lib/scanner/catalog.ts` | Agent types, 19 capabilities (data / tools / actions), 6 autonomy levels, 10 controls, limits. Shared by wizard and engine. |
| Validation | `lib/scanner/validation.ts` | Strict zod schema; every field is an enum except one ≤60-char label and the optional pasted text. |
| Pasted-content analysis | `lib/scanner/pasted.ts` | In-memory, regex-only signal extraction. Output = ids + capped counts. The text is dropped. |
| Risk engine | `lib/scanner/engine.ts` | Pure, deterministic. No clock, randomness, network or model. |
| Aegis control mapping | `lib/scanner/aegis-controls.ts` | Which real Aegis control answers each finding; unbuilt ones are labelled. |
| Persistence | `lib/scanner/service.ts`, models `RiskScan`, `ScannerAnalyticsEvent` | Anonymous-first; claim after sign-up. |
| Session | `lib/scanner/session.ts` | httpOnly cookie, only the SHA-256 hash is stored. |
| HTTP plumbing | `lib/scanner/http.ts` | Origin check, byte-capped JSON, safe error shape. |
| Rate limits | `lib/scanner/rate-limit.ts` | Reuses the shared Postgres limiter (`lib/rate-limit/postgres.ts`). |
| Analytics | `lib/scanner/analytics.ts` | Persisted funnel events, allowlisted properties only. |
| UI | `components/scanner/*`, `app/(marketing)/scan/*`, `app/(dashboard)/risk-scan/*` | Reuses `Badge`, `Alert`, `Button`, `EmptyState`, `ErrorState`, console `Panel`/`Metric`. |

**Pipeline** (as specified):

```
user input → validation (server) → normalisation → deterministic risk engine → structured result → UI
                                       ↘ pasted text → in-memory signals (ids/counts only) ↗
```

**No LLM is used.** Aegis has no LLM service (Ask Aegis is deterministic too), and a model adds no value to a
rule-based score while adding a prompt-injection surface. Because the report is composed from fixed templates and
allowlisted ids, there is nothing a pasted instruction can steer. The structured `ScanResult` type is the seam
where an *optional* explanation step could later be inserted (it would have to validate against the same type and
could never change `score`/`level`).

Routes:

| Route | Purpose |
|---|---|
| `/scan` | Indexable landing page + wizard ("Free AI Agent Security Scanner" metadata, canonical, in sitemap). |
| `/scan/report/:id` | Private report (noindex, no-store). Owner = creating browser session, or the claiming account/org. |
| `/scan/connect/:id` | "Connect your agent to Aegis": routes to sign-up / onboarding / claim. |
| `/scan/r/:slug` (+ `opengraph-image`) | Public share page (noindex; unfurls with an OG image). |
| `/risk-scan`, `/risk-scan/:id` | Dashboard: history, trend, Aegis security setup, agent linking, sharing. Needs `view_security`. |
| Command center card | Latest score, unresolved/resolved, trend, "Run a new AI Agent Risk Scan". |

## 2. User flow

1. Homepage hero primary CTA is now **"Scan your AI agent in 60 seconds"** (`/scan`); "Create a free account" is
   secondary. The nav and closing CTA lead with the scanner too.
2. Wizard (client state; one network request at the end). Steps: agent type → capabilities (Data/Tools/Actions
   cards) → autonomy (multi-select, "Read only" exclusive) → controls (In place / Partly / Not in place /
   Not sure) → optional paste. Adaptation: agent type highlights *common* capabilities (never preselects),
   the controls step orders and flags the questions *relevant* to what was selected, and the autonomy step
   explains when no actions were chosen. Progress survives a refresh via `sessionStorage` (pasted text never does).
3. `POST /api/scan` returns a report URL. The report shows overall score/level, counts (high / medium / lower /
   protected), top risks, a breakdown by area, findings, "what to fix first", protected areas and pasted-content
   signals. The findings are fully visible without an account.
4. After the report: the conversion panel ("Your agent has N high-risk behaviors. A scan tells you what is risky.
   Aegis helps you continuously monitor and control it.") with **Connect your agent to Aegis** and **Explore my
   risk report**, then the optional share panel.
5. Connect: signed out → `/sign-up?from=scan`; signed in without a workspace → `/onboarding`; signed in →
   claim and open `/risk-scan/:id`. Whichever way the visitor gets into an account (sign-up *or* sign-in), the
   dashboard layout claims the scans made in this browser (`claimScansForSession`). No scan data is put in a URL
   or form field — ownership travels in the session cookie.
6. In the dashboard: "Your Aegis security setup" (detected risks → recommended controls with honest status),
   optional link to an agent, history and trend.

## 3. Risk model

Ten categories (all required by the brief): excessive permissions, unrestricted tool access, autonomous external
actions, sensitive data exposure, code execution risk, prompt-injection exposure, missing approval gates, missing
monitoring, weak secrets isolation, excessive blast radius. Each rule in `engine.ts` has an exposure condition,
an inherent severity, evidence, and a set of weighted mitigating controls.

Every finding carries: title, severity, headline, evidence (each item tagged **Observed** — from your answers —
or **Inferred** — from agent type or pasted content), why it matters, potential impact, recommended mitigation,
and what Aegis can/cannot do about it. The report distinguishes observed configuration, inferred risk and
recommended mitigation by construction (`Evidence.kind`).

Notable rules:

- *Autonomous external actions* needs an external-effect action **and** autonomy ≥ "low-risk automatically".
  Severity follows the highest-impact action (email = high; payments/purchases = critical), −1 for low-risk-only
  autonomy, +1 for fully autonomous.
- *Sensitive data* escalates one step when ≥2 sensitive data classes can leave through an outbound path
  (email, web, API, code, cloud) **and** the agent acts autonomously.
- *Prompt injection* needs a source of untrusted content (web, inbound email — observed — or an agent type that
  typically reads outside content — inferred) plus privileges (sensitive data, external actions, code execution).
  Two or more factors = the "untrusted content + private data + ability to act" combination.
- *Weak secrets isolation* is **not** assumed from silence: it fires on selected credentials, secret-like strings
  in pasted text, or tool access plus an explicit "not in place" answer. A secret already pasted into a config
  cannot be offset by an isolation control.
- *Missing approval gates* can fire even when the user says actions are "with approval" if no enforced gate is
  confirmed (an approval policy that exists only in a prompt is not a control).

## 4. Scoring methodology

1. **Inherent severity** (1 low … 4 critical) per category from exposure (see rules above).
2. **Mitigation** `m ∈ [0,1]` = weighted average of the credit for the category's relevant controls:
   In place = 1, Partly = 0.5, **Not sure = 0.15**, Not in place = 0. Weights are in `engine.ts` per rule.
3. **Residual severity** = inherent − steps, where `m ≥ 0.9` → 3 steps, `m ≥ 0.7` → 2, `m ≥ 0.4` → 1.
   Below *low* ⇒ the area is **protected**. A critical capability can never be fully "protected" (best case: low).
4. **Points** per remaining finding: critical 35, high 22, medium 10, low 4.
5. **Score** = `100 × (1 − Π(1 − pᵢ/100))`, rounded: every finding adds, with diminishing returns, never above 100.
6. **Level**: 0–24 Low, 25–49 Moderate, 50–74 High, 75–100 Critical. Any single critical finding raises the level
   to at least High.
7. **Breakdown bars** (permissions, autonomy, data access, execution & injection, monitoring, blast radius) show
   the highest residual severity in the area on a 25/50/75/100 scale, with the level written out (not colour only).

The number is a heuristic, not a measurement. The report states this and also shows how many of the 10 controls
the user actually confirmed ("Not sure" earns little credit, so confirming controls can change the result).
Overlap is deliberate (e.g. approval gating informs three categories); the diminishing-returns combiner bounds
the double counting. `ENGINE_VERSION` (`scanner-v1`) is stored with each scan; stored results are frozen so a
later method change never rewrites history.

## 5. Aegis control mapping (what is real)

`lib/scanner/aegis-controls.ts` maps findings to controls that exist (permissions default-deny, policies,
approvals, append-only audit, alerts/incidents, behavioral baselines, risk-driven control, kill switch, budgets,
simulator, data-class/destination conditions, telemetry secret redaction) and states limits: enforcement applies
to agents that call Aegis (SDK `guard()` / evaluate), and Aegis is not in the agent's data path.
Labelled **Coming soon**: credential brokering. Labelled **Outside Aegis**: sandboxing, network egress
filtering, prompt-injection detection. Unbuilt controls are never linked. The wording is "Aegis can monitor and
help control", never "prevents".

## 6. Database

Migration `20261011120000_free_risk_scanner` (additive; no existing table touched; verified with
`prisma migrate diff` = no drift). Scalar ids only, no foreign keys (isolated from legacy tables).

`risk_scans`: `id` (128-bit random token, app-generated), `sessionHash`, `userId?`, `organizationId?`,
`connectedAgentId?`, `agentType`, `agentLabel?`, `capabilities`, `autonomy`, `controls`, `inputSignals?`
(pasted-content signal ids/counts and a char count — **no text**), `engineVersion`, `score`, `level`,
`highRiskCount`, `mediumCount`, `result` (full structured result), `isPublic`, `publicSlug?` (unique),
`publishedAt?`, `expiresAt?`, `claimedAt?`, `createdAt`.

`scanner_analytics_events`: `event`, `visitorHash` (16-char prefix of the session hash), `scanId?`,
`organizationId?`, `properties` (allowlisted scalars), `createdAt`.

Retention: anonymous scans expire after 30 days (expired rows are purged opportunistically on later scans, as the
rate limiter does); publishing keeps a scan 90 days; claimed scans have no expiry. Unpublishing drops the slug.

## 7. API

| Endpoint | Behaviour |
|---|---|
| `POST /api/scan` | JSON body. Origin check → IP rate limits (10/hour, 30/day) → 48 KB cap → JSON parse → strict validation → session rate limit (15/day) → create. `201 {id, reportUrl, score, level}`. Errors: 400 `invalid_json`, 403 `forbidden_origin`, 413 `payload_too_large`, 415, 422 `invalid_input` (+ field messages that never echo input), 429 (+ `Retry-After`), 500 safe message. Sets the session cookie if absent. Signed-in members get an owned scan immediately. |
| `POST /api/scan/events` | Funnel beacons. Only `scanner_viewed`, `scanner_started`, `scanner_step_completed`, `scanner_completed`, `report_shared` are accepted from browsers (120/min/IP). |
| `POST /api/scan/:id/share` | `{public: boolean}`. Owner only; same 404 for "not yours" and "doesn't exist". 30/hour/IP. |
| `GET /scan/connect/:id` | Redirect logic described above. |

## 8. Security considerations

- **Never executed, fetched or forwarded.** Pasted text is normalised (control / zero-width / bidi characters
  removed, NFKC) and matched against bounded linear-time regexes (adversarial inputs tested < 500 ms).
- **Untrusted text cannot become output.** Results contain only ids, labels from fixed tables, and counts. A
  secret-like string is reported as a count; the value is never stored, logged or displayed. Pasted text can only
  *add* evidence: approval claims are not credited and instruction-like text ("ignore previous instructions…")
  is flagged and has no effect on the score (tested: identical score with and without the attack).
- **Output sanitisation.** The only user free text is the "Other" label: markup, links, template/shell characters
  and invisible characters are stripped, ≤ 60 chars, rendered by React as escaped text, and never shown publicly.
- **Input validation** is server-side and strict: unknown keys, unknown enum values, wrong types, >10,000 chars
  of pasted text (rejected, not truncated), body > 48 KB, non-JSON content type, malformed JSON.
- **Abuse protection:** per-IP hourly and daily limits, per-session daily limit, stricter caps on events/share.
  The limiter fails open on database errors (existing P0 behaviour), as it protects capacity, not authorization.
  Known limitation: `x-forwarded-for` is best-effort.
- **CSRF:** cookie-authenticated POSTs refuse a cross-site `Origin`.
- **Sessions:** 256-bit random token in an httpOnly, SameSite=Lax (Secure in production) cookie; only its hash is
  stored. Report ids are not credentials: a private report needs the session or the owning account. A claimed
  scan is no longer readable by a bare session (shared computers).
- **Safe errors:** responses never echo request content or internal error text; logs record only an error name.
- **No secret logging / no analytics leakage:** analytics properties pass an allowlist; no answers, text, labels
  or IPs are stored.
- **Public pages:** a projection type with no field for private data (score, level, counts, finding titles,
  severities, one recommendation each); noindex; fail closed on corrupt, expired or unpublished rows.
- The cookie is a first-party functional cookie. The privacy page's cookie statement should be reviewed to
  mention it (see "Open items").

## 9. Analytics events

Persisted in `scanner_analytics_events`: `scanner_viewed`, `scanner_started`, `scanner_step_completed`
(step number only), `scanner_completed`, `scan_generated`, `high_risk_detected`, `report_viewed`,
`report_shared` (channel: publish / copy / x / linkedin), `connect_aegis_clicked`, `signup_started`,
`scan_claimed`, `signup_completed` (when the claiming user was created in the last 24 h), `agent_connected`
(dashboard link, and a real agent connection by a workspace that has a claimed scan), `trial_started` /
`subscription_started` (attributed in `lib/billing/sync.ts` to the workspace's earliest claimed scan; no-op for
workspaces without one). `landing_cta_clicked` keeps using the existing stub with new `source` values
(`hero_scan`, `nav_scan`, `cta_section_scan`, `mobile_nav_scan`). Funnel queries are simple counts by event over
`visitorHash`/`scanId`.

## 10. Testing

- `lib/scanner/__tests__/engine.test.ts` — calibration (low / high / critical), each category, combinations,
  determinism, honesty (no absolute claims; unbuilt controls never "available"), pasted-content resistance.
- `security.test.ts` — malformed/unexpected values, enum abuse, XSS and template payloads, oversized input,
  invisible characters, adversarial regex input, count caps, analytics sanitisation.
- `app/api/scan/__tests__/route.test.ts` — malformed JSON, content type, oversize, no reflection, origin check,
  **rate limit (11th scan → 429)**, safe 500 with no leakage, event forgery refused.
- `share-and-model.test.ts` — public projection leaks nothing, ownership rules, trend diff, Aegis mapping honesty,
  wizard state logic.
- `components/scanner/__tests__/scanner-ui.test.tsx` — scanner start, report content, escaping, conversion and
  share copy, responsive classes (`grid-cols-1 sm:grid-cols-2`), hero CTA.
- `app/(marketing)/scan/connect/[id]/__tests__/route.test.ts` — signup transition and scan preservation.
- `lib/scanner/__tests__/service.integration.test.ts` (needs `DATABASE_URL_TEST`) — persistence, data
  minimisation (canary secret/prompt never in the row), claim idempotency and tenant isolation, expiry,
  publish/unpublish, attribution.

## 11. Limitations (stated, not hidden)

- It is a self-assessment: the result is only as good as the answers. Without the pasted-content step nothing is
  verified, and even with it the analysis is pattern matching, not semantic understanding.
- No LLM explanation layer (deliberate).
- Anonymous reports are tied to one browser; clearing cookies or switching device loses private access (the UI
  explains this and offers a re-scan).
- "Resolved" in the trend means a finding disappeared between two scans, based on answers; it is not verified.
- Rate-limit keys use best-effort client IP.
- Mobile layout is covered by markup assertions and responsive classes, not by a device test; it hasn't been
  checked in a real browser in this pass.

## 12. Open items

1. Mention the scanner's session cookie in `/privacy` (cookie wording currently lists only sign-in and active
   organization). Left unchanged because it is legal copy.
2. A scheduled purge of expired scans (today: opportunistic).
3. Admin view of the scanner funnel (events are stored; no UI yet).

## 13. Future phases (not built; Phase 1 does not block them)

| Phase | Hook |
|---|---|
| 2 Agent configuration analysis | Extend `pasted.ts` with structured parsers (MCP / tool-definition JSON); signals already feed `Ctx` as inferred capabilities. |
| 3 Log analysis | New signal sources behind the same `PastedSignalSummary` contract. |
| 4 Connected live scanning | `RiskScan.connectedAgentId` + the existing agent permissions/policies can supply *observed* evidence in place of answers. |
| 5 Continuous monitoring | Re-run on a schedule; `diffScans` and the history UI are the trend substrate. |
| 6 Policy recommendations | `Finding.mitigations` + `aegis.controls` map directly to policy templates. |
| 7 Continuous enforcement | Findings → `risk-control` settings via the existing risk-control plan. |
