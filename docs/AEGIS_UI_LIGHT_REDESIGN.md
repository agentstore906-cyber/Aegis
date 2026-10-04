# Light console redesign (Oct 2026)

Supersedes the dark console theme described in `AEGIS_UI_IMPLEMENTATION.md`. UI only: no engine, policy, risk, auth or enforcement change.

## Design system (`app/globals.css`, `.aegis-console`)
- White, ink-on-white tokens. `--brand` is ink (primary buttons, focus ring, active nav); color is reserved for state (success/warning/danger/risk/approval/info).
- 15px base, tighter heading tracking, sentence-case `.section-label`, hairline borders, `--shadow-pop` only for menus. Cards are `rounded-xl`; `Metric` is borderless; `Table` headers are sentence case.
- Marketing, auth and the public demo are untouched (tokens are scoped to the console wrapper).

## Navigation (`lib/dashboard-nav.ts`, `components/dashboard/nav-list.tsx`)
Primary: Command center, Agents, Risk (`/risk-control`), Policies, Approvals, Incidents, Audit. Everything else that exists (Activity, Security alerts, Control plane, Risk scanner, Costs, Ask Aegis, Developers, Integrations, Billing) sits under a collapsed "More" that opens when the current page is inside it and still shows open-alert counts. Settings and Feedback are pinned at the bottom. There is no Help page, so none is shown. Role filtering is unchanged.

## Pages
- Command center: headline sentence built only from counts ("N items need your attention." / "Nothing is waiting on you."), attention list, five plain figures (Agents, Risk, Incidents, Policies, Approvals), activity stream, posture. Empty org: one "Connect agent" action; the "view demo" link was removed. Added read-only `countActivePolicies`.
- Agents list: name + environment, connection state, risk, trust, last activity. Connection is the evidence-derived state, trust appears only when the trust engine evaluated the agent ("Not evaluated" otherwise). `lib/agents/list-signals.ts` batches this (3 queries per page).
- Agent workspace: breadcrumb, connection/environment/risk/last-seen header on every tab, primary tabs + native "More" disclosure. No tabs were invented: Risk/Incidents/Audit are covered by Behavior, Security (alerts, with audit link) and the org Audit page.
- Activity rows read "Agent requested <action>" with destination/tool and time.

## Not done / limits
- Approvals, Policies, Incidents, Risk and Audit pages inherit the new tokens, header and badges but were not individually redesigned (e.g. Incidents still uses boxed metric tiles).
- No notifications UI (no backend for it) and no environment switcher (organizations have no environment).
- Phone layout was not visually verified (the browser window would not resize); it relies on the existing responsive classes and mobile drawer.

## Update: progressive disclosure (same day)
The permanent sidebar is gone. The shell is a top bar only: the Aegis logo opens the full navigation (`components/dashboard/nav-drawer.tsx`, a focus-trapped dialog at every screen size, with Upgrade at its foot), then the workspace name, search (icon, Ctrl/⌘K) and the account menu. No destination was removed; the drawer holds the same 7 primary + "More" + Settings/Feedback.

Home (`/overview`) is now nearly empty by design and shows only real data:
- 0 agents: "Control your AI agents." with Connect agent, Risk scanner (`/scan?from=dashboard`, the existing scanner) and Upgrade (only for roles that can view billing). Archived agents don't count.
- 1 agent: the agent as the primary object (name, truthful connection state, Open agent).
- 2+ agents: a plain list; 4+ scrolls inside the list; more than one page links to "View all N agents".
- Below the agent(s): "+ Connect another agent", Risk scanner, Upgrade. One quiet line appears only when it is non-zero and the role may see it: approvals waiting / open incidents, because a pending human decision is the one thing that can hold an agent up.
The old Command Center widgets (activity feed, posture, onboarding checklist, scanner summary card) were removed from home; their data is still reachable under Agents, Activity, Approvals, Incidents, Control plane and Risk scanner. The orphaned `OnboardingChecklist` and `RiskScanOverviewCard` components were deleted.

Bug caught in browser testing: `backdrop-blur` on the sticky header made it the containing block for the drawer's `fixed` overlay, clipping the menu to 56px. The header is now solid.
`next.config.ts` gained `allowedDevOrigins: ["127.0.0.1"]` (dev server only) so the app hydrates when opened at 127.0.0.1.
