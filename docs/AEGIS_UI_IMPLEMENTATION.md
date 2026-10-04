# Aegis UI implementation

Companion to `docs/AEGIS_UX_AUDIT.md` (the audit written before any code). This records what was built, what it
depends on, how it was tested, and — plainly — what was not done.

## 1. Design system

- **Theme.** A dark "console" theme is applied by redefining the semantic CSS variables under the `.aegis-console`
  wrapper in `app/globals.css`. Components keep using `bg-surface`, `text-foreground`, `border-border` and so on, so
  nothing was rewritten per component, and the marketing site, auth pages and `/demo` stay light.
- **Color means state, nothing else.** SAFE `success`, WARNING `warning`, RISK `risk`, BLOCKED `danger`, APPROVAL
  `approval`, SYSTEM `info`/`brand`. New tokens: `--risk*`, `--approval*`.
- **Type and motion.** Geist Sans/Mono, tabular numerals (`.num`), small uppercase `section-label`. One short
  entrance animation (`aegis-enter`, fill-mode `backwards` so it never leaves a transform that would trap `fixed`
  children). `prefers-reduced-motion` removes all animation.
- **Honest vocabulary** (`lib/ui/vocabulary.ts`, 15 tests): Aegis is a decision service and audit trail, not in the
  agent's data path. *Blocked* = Aegis returned BLOCK; *Recorded* = an agent reported it; *Awaiting approval*;
  never "enforced / prevented / protected". A test fails if a forbidden word appears in any presentation.
- **Primitives.** `components/console/primitives.tsx` (`Panel`, `Metric`, `StateLine`, `SectionLabel`, `PanelLink`),
  `components/ui/empty-state.tsx` (what / why / next), `components/ui/error-state.tsx`,
  `components/console/page-skeletons.tsx`, `components/dashboard/status-badges.tsx` (all state badges, one source).

## 2. Information architecture

Navigation is grouped by the order of an operator's work (`lib/dashboard-nav.ts`):

| Group | Items |
|---|---|
| Command | Command center, Control plane |
| Fleet | Agents, Agent Arena |
| Respond | Approvals, Incidents, Security alerts, Risk control |
| Govern | Policies, Audit |
| Observe | Activity, Costs |
| Platform | Developers, Integrations, Billing, Settings |
| Utility | Ask Aegis, Feedback |

Renames: Overview → Command center, Security → Security alerts. Items stay capability-gated; a group with no
visible items disappears. Counts beside Approvals, Incidents and Security alerts are real `COUNT` queries
(`lib/dashboard-nav-counts.ts`); if a count cannot be read, no badge is shown.

## 3. Pages redesigned

- **Command center (`/overview`)** — only sections backed by real data. Headline metrics; "Requires attention"
  (non-zero items only); configured risk-control mode with what it does and does not do; integration coverage
  (from the control-plane inventory); decisions in the last 24 h; recent activity; agents needing attention; open
  incidents; high-severity alerts. Security panels are shown only to roles that may view them. With no agents the page
  shows one truthful empty state and the setup checklist, with no zero-filled placeholder figures.
- **Shell.** Skip link, `<main id="main">`, `aria-current`, page-enter template, accessible mobile drawer.
- **Activity.** The misleading "Live" badge was removed; the page says it refreshes itself and has no live stream.
- **Control plane.** The "Protected" posture is now labelled "Asks Aegis" (it never meant that actions are stopped).
- **Demo.** Retitled "Demo (sample data)" in the page title and footer.
- **Everywhere.** Status badges use the shared vocabulary (activity rows, approvals, security, graph timeline).
- **Loading skeletons** now exist for every dashboard section, shaped like the page they stand in for.

## 4. Components created

`NavList`, `MobileSidebar` (modal dialog: focus trap, Escape, scroll lock, focus return), `PaletteHost` +
`CommandPalette` (lazy), `Panel`/`Metric`/`StateLine`, `ErrorState`, `ListPageSkeleton`/`PanelsPageSkeleton`,
`LiveActivityRefresh` (honest auto-refresh chip), `lib/dashboard-commands.ts`.

## 5. API and data dependencies

| UI element | Source | Fallback when absent |
|---|---|---|
| Agent counts | `getAgentStats` | empty state, no figures |
| Awaiting approval | `getApprovalStats`, nav count | 0 hidden in nav |
| High/critical alerts, open incidents | `getSecurityStats`, `searchIncidents`, nav counts | panel hidden for roles without `view_security` |
| Risk control mode | `getRiskControlSettings` | panel replaced by decision counts |
| Integration coverage | `getInventory().summary` | panel hidden |
| Decisions 24 h | `getPolicyDashboardStats` | "no decisions" explanation |
| Spend | `getOrgSpendSummary` | — |
| Search | `GET /api/search` → `lib/search/service.ts` | "search unavailable"; navigation still works |

The only backend addition is **global search**: read-only, session-authenticated, organization taken from the
membership (never the request), groups the role may not view are not queried, bounded (2–80 chars, 5 per type,
30-day activity window), `%`/`_`/`\` escaped. The unescaped `%%` match-everything bug was found by the new test and fixed.

## 6. Accessibility

Skip link; `aria-current="page"`; named landmarks and nav groups; drawer is `role="dialog" aria-modal` with focus
trap and Escape; palette follows the combobox/listbox pattern (`aria-activedescendant`, polite status); nav counts
have screen-reader text; state is always words, never color alone; reduced-motion respected.
**Not verified:** no screen-reader or automated browser audit (axe/Lighthouse) was run. These are code-level measures only.

## 7. Performance

The palette is lazy (not in the initial bundle); search is debounced 200 ms with abort of stale requests; no polling
while the tab is hidden; navigation counts are three indexed `COUNT`s; the Command center runs its queries in
parallel and skips security queries for roles that cannot see them.

## 8. Testing results

- `tsc --noEmit`: clean. `eslint app components lib`: clean. `next build`: succeeds.
- Full vitest (unit + integration, local disposable Postgres): 1189 passed, 3 failed — all in
  `p2-behavioral-memory` / `p3-agent-trust`, which this work did not touch. One of the three (`p2` "today never
  teaches itself") failed again on a rerun; the other two passed on rerun. The cause looks like those tests computing
  "today" from the wall clock (the run happened at 23:54 local, next to a day boundary). Not yet investigated further.
- New: vocabulary (15), nav/commands (9), search service + route integration (23, including tenant isolation, role
  gating, wildcard handling, INC-n lookup, bounds, 401/403/503).
- Not run: browser/visual checks, e2e, a11y tooling.

## 9. Known limitations

- **Not live.** Updates come from periodic server re-render; the UI says "auto-refresh", never "live".
- **Risk Scanner:** added later (Oct 2026) as a separate feature — see `docs/AEGIS_FREE_RISK_SCANNER.md` (nav item "Risk scanner", `/risk-scan`). Agent Arena remains separate.
- **Partial pass on sections 4–9.** Badges and wording are consistent everywhere, but the agent header, decision/incident
  detail view, policy "rule sentence" view, approval center and audit pages were **not** individually redesigned beyond that.
- Dark theme covers the dashboard only; marketing, auth and demo are intentionally unchanged.
- Palette searches names/ids/titles only, not event payloads.

## 10. Remaining UX opportunities

Per-agent header with state, trust and risk reasons; decision detail page with why / response / evidence links;
policies shown as readable rule sentences (`lib/policies/describe.ts`); approvals list using `approvalState` end to end;
real-time transport if a websocket is ever added; an a11y audit in CI.
