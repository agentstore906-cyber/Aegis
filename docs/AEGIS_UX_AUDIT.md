# Aegis UX Audit

> Historical: this audit predates the removal of Agent Arena (`docs/AEGIS_AGENT_ARENA_REMOVAL.md`); its Arena mentions describe a feature that no longer exists.

Written before the redesign (command-center work). It inspects the real frontend as it was at the end of P8, so the redesign answers actual problems rather than a template. Companion document, written after: `docs/AEGIS_UI_IMPLEMENTATION.md`.

## 1. What exists

**Stack.** Next.js 16 App Router, React 19, Tailwind v4, Geist Sans/Mono, lucide icons. ~143 component files (67 client components), 37 authenticated routes. **Server-rendered by default**; client JS is limited to forms, filters, the mobile drawer, a polling refresher, and a few interactive widgets.

**Design system as it stands.** All colors are **semantic CSS variables** (`--background`, `--surface`, `--surface-muted`, `--border`, `--success/warning/danger/info/brand` with `-bg`/`-border` variants) exposed through Tailwind's `@theme`. Primitives in `components/ui`: `Card`, `Badge` (6 tones), `Button`/`ButtonLink`, `Alert`, `EmptyState`, `Skeleton`, `Table`, `Pagination`, `ConfirmDialog` (native `<dialog>`), `Input/Select/Textarea/Label`, `CodeBlock`. In `components/dashboard`: `Sidebar`, `MobileSidebar`, `Topbar`, `PageHeader`, `StatCard`, `status-badges` (agent, risk, decision, approval, activity, alert, connection), `OnboardingChecklist`, `PhasePreview`.

**Important fact for the redesign:** a search of the dashboard and component code finds **no hard-coded palette classes or hex colors** — everything is token-driven. A dark-first command-center theme can therefore be applied by redefining tokens (scoped to the authenticated console so marketing, auth and the demo are untouched) without rewriting hundreds of components. That is the lowest-risk way to make the whole product coherent.

## 2. Current navigation

A **flat list of 18 items** in one column: Overview, Agents, Control plane, Agent Arena, Activity, Ask Aegis, Approvals, Policies, Security, Incidents, Risk control, Costs, Audit, Integrations, Developers, Feedback, Billing, Settings. Capability-filtered per role (correct and kept). Active state is a background tint only.

## 3. Current pages (37 routes)

Overview · Agents (list, detail with 12 tabs, new, edit, permissions) · Control plane · Activity (list, event) · Approvals (list, detail) · Policies (list, new, edit, tester, evaluations list/detail) · Security (alerts list, detail) · Incidents (list, detail) · Risk control · Costs · Audit (list, detail, export) · Arena (list, detail) · Ask · Developers (keys, quickstart) · Integrations · Feedback · Settings (organization, billing) · Upgrade.

## 4. UX problems

| # | Problem | Evidence |
|---|---|---|
| U1 | **Nothing communicates system state.** The Overview is six equal stat tiles and seven equal-weight cards in a light "SaaS" theme. It does not answer *is anything dangerous?* first, and it does not use P4–P8 at all (risk control mode, enforcement posture, incidents, posture, coverage). | `app/(dashboard)/overview/page.tsx` |
| U2 | **Information architecture grew by accretion.** Security, Incidents, Risk control, Control plane and Approvals overlap in purpose; operational and utility items (Feedback, Ask, Arena) sit at the same level; there is no grouping to scale. | `lib/dashboard-nav.ts` |
| U3 | **Empty sections are noise.** Every empty card renders its own dashed EmptyState; a calm organization sees six "nothing here" boxes. | overview |
| U4 | **Empty states don't teach.** Most say what is empty but not why or what to do next. | `components/ui/empty-state.tsx` |
| U5 | **No global search or command palette.** Reaching an agent, incident or policy means navigating lists. | no `lib/search` |
| U6 | **Honest-language inconsistency.** The word "Blocked" is used for (a) Aegis *returning* BLOCK, (b) an agent's own self-reported guardrail, and (c) a status on an activity row, with no distinction. Aegis does not sit in the data path (architecture doc §4), so "blocked" must always mean *Aegis denied the request*; it must never read as *the action was physically prevented*. | `status-badges.tsx` |
| U7 | **Freshness is invisible.** Activity pages poll every 5 s with no indication of when data was last refreshed, no pause when the tab is hidden, and no offline state. | `live-activity-refresh.tsx` |
| U8 | **Duplicated UI.** Five different hand-rolled "list row" layouts, three "key/value" grids, and per-page heading/empty/section patterns. | across `components/*` |
| U9 | **Inconsistent loading states.** `loading.tsx` exists for ~5 routes; incidents, control, risk-control, policies, approvals and others show a blank wait. | route tree |
| U10 | **Generic error boundary.** "Something went wrong on our end" — no statement of whether data may be stale or what to do. | `app/(dashboard)/error.tsx` |
| U11 | **A decision view that does not read as one.** A blocked / approval-required decision is shown as a policy-evaluation record, not as *what was attempted, why, what Aegis returned, and what to look at next*. | `policies/evaluations/[id]` |
| U12 | **Agent page is 698 lines of tabs with no status hierarchy.** State, trust and risk are not the first thing seen. | `agents/[slug]/page.tsx` |
| U13 | **Policies read as a CRUD table**, not as rules (*who → where → under what condition → what decision*), although `describePolicy()` already produces that sentence. | `policies-table.tsx` |
| U14 | **The public `/demo` route is titled "Live Demo"** while running on hard-coded sample data. It is isolated from the product and does carry a "Sample data" banner, but "Live" is a misleading word for sample data. | `app/demo/page.tsx`, footer link |

## 5. Accessibility issues

- No **skip-to-content** link; no `aria-current="page"` on the active nav item.
- The **mobile drawer** (`MobileSidebar`) has no Escape handling, no focus management/return, and no `role="dialog"`/`aria-modal`.
- Positive: visible focus ring utility (`focus-ring`), `prefers-reduced-motion` handled globally, semantic landmarks (`aside`, `nav` with `aria-label`, `main`, `header`), native `<dialog>`.
- Colors communicate state in badges alongside text labels (good); the dark theme must keep text contrast ≥ 4.5:1 and never rely on color alone.

## 6. Performance issues

- `LiveActivityRefresh` polls with `router.refresh()` every 5 s **even when the tab is hidden** (wasted server work) and offline.
- The Overview runs ~11 parallel queries and renders every section regardless of whether it has content.
- No per-route streaming for several data-heavy pages (see U9).
- No unbounded list was found: lists are paginated; the action graph and incident views are windowed (P6/P7).

## 7. Data and API gaps (documented, not fabricated)

| Wanted | Reality | Decision |
|---|---|---|
| **AI Agent Risk Scanner** | **Does not exist** — no code, route or doc (`docs/AEGIS_CURRENT_STATE.md` row 126). The nearest real thing is the **Agent Arena** (a configuration-posture benchmark) and the runtime Agent Risk Score. | **No scanner UI is built.** Arena is kept and restyled; the gap is stated. |
| Real-time stream | **Polling only** (server refresh). No websocket/SSE, no connection-state API. | Show *"Auto-refresh every 5 s · last refreshed HH:MM:SS"*, **never "LIVE"**; pause when hidden; show **Offline** from the browser's own connectivity state. |
| Global search | None. | Add a small, read-only, tenant-scoped, capability-aware search service (tests included). The only backend addition. |
| "Last evaluated" for the threat surface | No such concept stored. | Show the newest real alert/incident time if one exists; otherwise nothing. |
| Agent "states" ACTIVE/MONITORED/RESTRICTED/STOPPED/UNKNOWN | Stored: ACTIVE, PAUSED, STOPPED, NEEDS_ATTENTION, ARCHIVED. P8 derives posture (PROTECTED, OBSERVED, QUIET, DISCOVERED …). RESTRICTED is a *trust* state (advisory). | Use the real stored + derived states and trust states only; never invent "MONITORED". |
| Approval states | PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED; "consumed" is `consumedAt`, "valid" depends on `executionExpiresAt`. | Derive a display state *from those fields*; never show an approval as usable when expired or consumed. |
| Per-tool risk, agent relationships | Not stored. | Not shown. |

## 8. Proposed information architecture

Grouped navigation, organized by the operator's job (the structure that scales as capabilities are added), all items real and capability-filtered:

```
COMMAND      Command center · Control plane
FLEET        Agents · Agent Arena
RESPOND      Approvals · Incidents · Security alerts · Risk control
GOVERN       Policies · Audit
OBSERVE      Activity · Costs
PLATFORM     Developers · Integrations · Billing · Settings
             (utility: Ask Aegis · Feedback)
```

Plus: a **command palette / global search** (Ctrl/⌘ K), an honest **freshness chip**, a persistent top bar with organization, search, and user. Renames: Overview → **Command center**; Security → **Security alerts** (disambiguates from Incidents).

**Design language.** One dark-first "console" theme applied by tokens to the authenticated shell; Geist Sans for text and Geist Mono for identifiers/numbers; a small set of state colors used *only* for state (safe, warning, risk, blocked, approval, system); 1px hairline borders, restrained depth, a single subtle focus glow; motion limited to short state transitions and respecting reduced motion.

## 9. What will and will not be done

Will: theme tokens; grouped navigation and shell; honest-vocabulary module; shared primitives (panel, section label, state indicator, metric, empty/loading/error states); Command Center; decision (blocked/approval) view; agent header with state/trust/risk; policy-as-rule sentences; approval derived states; command palette + search; freshness chip; accessibility fixes; loading states for every dashboard route; documentation.

Will not: build a Risk Scanner (does not exist); invent states, scores, graphs, "AI detected" messages or sample data; claim real-time; change security or business logic; restyle marketing/auth/demo (except honest relabeling of the demo).
