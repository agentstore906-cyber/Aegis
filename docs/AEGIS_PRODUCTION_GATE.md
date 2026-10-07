# Aegis — final production gate (2026-10-07)

Scope: verification and targeted fixes only. No UI redesign, no new features, no fake activity, no security weakening.

## Method
- Fresh Postgres database (`aegis_gate_test`, all migrations applied) for the server, the browser run and the final suite.
- Production build (`next build`), served with `next start` on 127.0.0.1:3100, **with all `PADDLE_*` secrets blanked** so nothing could reach the live Paddle account.
- Real Chrome driven by Playwright (scratchpad only, not in the repo). The external agent is a separate OS process using the built `@aegis/agent-sdk` (`packages/agent-sdk/dist`). Nothing about the connection was mocked.

## 1. Real browser Connect flow — verified
Sign-up → onboarding → Connect an agent → name → credential screen (revealed from the page, as a user would copy it).

| Moment | What the browser showed | Backend evidence |
|---|---|---|
| Credential issued, agent not started (8 s, ≥2 polls) | `CONNECTING`; stages "Identity verification — In progress", the rest "Not yet"; **no** "Agent connected" | `state=WAITING monitoring=NONE events=0` |
| Real SDK `handshake()` | "AGENT CONNECTED"; text "Monitoring starts when your agent reports its first event."; **no** "Monitoring is active" | `state=CONNECTED monitoring=NONE events=0` |
| Real SDK `track()` | "Monitoring is active." | `state=CONNECTED monitoring=RECEIVING events=1` |
| **View agent** | `/agents/gate-browser-agent` (the agent just created); Connected, 1 reported event, the real `crm lookup` event under Recent activity | — |

The browser *can* observe the live transition: `useConnectionStatus` polls `GET /api/agents/:slug/connection` every 3 s (paused while the tab is hidden). The UI never advances on a timer. A single handshake request moves the backend straight from WAITING to CONNECTED, so the intermediate `AUTHENTICATING`/`VERIFYING` phases are only visible for agents whose credential is verified before first contact (provider connectors), not for SDK agents. That is accurate, not a defect.

Disconnect / reconnect from the agent page (second agent, repeated after the fix below):
1. Disconnect → state **Revoked**; the old key's `handshake` and `track` → `AegisAuthenticationError`.
2. Reconnect → new, different credential; state **Waiting for your agent**; old key still rejected.
3. Real handshake with the new key → **Connected** again.

### Defect found and fixed
After Disconnect (and after Reconnect, before first contact) the agent page still said **"Monitored"** (and the protection panel showed a green dot), because `monitoringLabel` was computed from event history only. A revoked or waiting agent cannot be monitored.
- `lib/agents/connection-state.ts`: `monitoringLabel` is now state-aware — "Not monitoring · disconnected" (revoked), "· connection problem" (error), "· waiting for reconnect" (waiting with history). The `monitoring` enum, `connectionSummary`, list pages and phases are unchanged.
- `components/agents/connection/agent-protection-status.tsx`: green dot only when `CONNECTED` and `RECEIVING`.
- Test added (`connection-state.test.ts`). Re-verified in the browser after rebuild.

Residual note: after a reconnect handshake, "Monitored" returns immediately if an event arrived within the last 24 h (the existing `RECEIVING` rule). That is backend evidence, but it is history from before the reconnect.

## 2. The three failing tests
Root cause of all three: the cron route (`GET /api/internal/behavior/refresh`) is cross-tenant **by design** (it sweeps every agent in the database), and two test files called it unscoped.

| Test | Classification | Evidence |
|---|---|---|
| A. p3 "daily cron evaluates agents that never were" (5 s timeout) | **Database size** (fixture accumulation) — not an app bug | Passed on a fresh DB; timed out on the 246-agent `aegis_test` DB because the sweep evaluated every agent. |
| B. p2 "one extreme volume event…" (and its sibling "today never teaches itself…") | **Cross-file test isolation** | p2 alone: 22/22 on 4 runs. p2+p3 in parallel: one p2 test failed on 3 of 3 runs (a different one each time). `--no-file-parallelism`: 56/56. p3's sweep created baselines for p2's agents with the real clock before p2's tests asked for them with their own clock (baselines are immutable per day). |
| C. p2 "scheduled refresh endpoint" | Same mechanism: the sweep touches other files' orgs while they are being created/torn down | Same fix. |

Fix (no timeout was raised): `refreshStaleBaselines` / `refreshTrust` accept an optional `organizationIds` filter (production passes none, behavior unchanged); both test files wrap the two sweeps with `vi.mock` so the real route runs scoped to the file's own organizations. Result: p2+p3 in parallel pass 2/2 on the 246-agent polluted DB, and on the clean DB.

A fourth, one-off failure appeared in one full run: `control-plane.integration` "counts decided vs undecided…" timed out at 5.03 s. It makes ~11 sequential HTTP-handler calls; it passes alone in well under a second (3/3) and the failing run overlapped with a concurrent Playwright sweep. The re-run with no other load passed 1396/1396. Classified as load-induced timing; no change made.

## 3. Paddle
- `/upgrade`, `/pricing`, `/settings/billing` load. Prices come from `PLANS`: Free $0, Startup $5, Growth $299, Business $999, Enterprise custom. With no Paddle credentials the paid-plan CTA reads "Contact us to upgrade" and the billing page says billing is not configured (honest, no broken button).
- **Checkout session creation: BLOCKED, not verified.** The repo's `.env` contains only a *live* key (`pdl_live_…`, client token `live_…`) and `PADDLE_ENVIRONMENT=sandbox` (the resolver correctly overrides it to production). There are no sandbox credentials. Read-only probes of the live API (`/event-types`, `/prices`, `/products`, `/customers`, `/transactions`, `/subscriptions`) all returned **403 `request_error/forbidden`** — the key still has no permissions at all (same as the 2026-09-10 finding). No writes were made against the live account and no checkout was attempted.
- Required Paddle configuration (from `lib/billing/actions.ts` / `sync.ts`): a key with `customer.read/write`, `transaction.read/write`, `subscription.read/write`, `price.read`, `product.read`, `customer_portal_session.write` — in **sandbox** for testing (`pdl_sdbx_…` key + `test_…` client token + sandbox `pri_…` ids + `PADDLE_ENVIRONMENT=sandbox`) and in live for production; plus `PADDLE_WEBHOOK_SECRET` from a notification destination subscribed to `subscription.created/updated/canceled`, `transaction.completed`, `transaction.payment_failed`. Do not paste keys into chat; set them in Vercel.
- Verified by automated tests (94 pass): webhook signature (missing / wrong secret rejected), replay of the same event id is a no-op, `subscription.created/updated/canceled`, `transaction.payment_failed` → `past_due`, `transaction.completed` recovery, and tenant isolation (only the org named in verified `custom_data` changes). Payment success/failure is webhook-driven; closing the overlay changes no state. These are code-level proofs, not a sandbox checkout.

## 4. Activity feed
Unchanged. The agent page shows real events only (the real `crm lookup` above) and the existing truthful empty state. Real-time activity feed requires backend support.

## 5. Security sanity (all against the running production server)
Anonymous page → 307 to sign-in; `/api/agents/:slug/connection`, `/api/v1/agents`, `/api/search` → 401; cron route without `CRON_SECRET` → 503 (fails closed). Real-agent E2E (20 tests) + org-isolation (11 tests): unknown/malformed/unauthenticated credentials rejected; org-wide key cannot handshake; expired, revoked and post-disconnect credentials rejected (including a *different* still-valid key bound to the disconnected agent); reconnect issues a new credential and stays WAITING until real contact; handshake / `Idempotency-Key` / `clientEventId` idempotency; agent A cannot act as agent B; identity in the request body is ignored; org A cannot reach or modify org B (same slug in two orgs); a policy BLOCK stops a guarded call and an agent that ignores the decision is reported as having run despite it; three agents connect independently.

## 6. Final run numbers
See the report in the conversation (tsc, eslint, 818 unit, 1396 total, 54 SDK, build, browser).

## Not fixed (reported)
- Mobile (390 px): `/settings/organization` and `/developers/api-keys` scroll horizontally (wide unwrapped tables). Pre-existing, cosmetic.
- ESLint: 4 pre-existing `_prev` unused-variable warnings.

## Addendum: generic agent Risk Score removed
Removed lib/security/risk-score.ts, getAgentRiskScore, the agent-page Risk score card, the RiskMeter/Configured-risk display (agent cards, agent header, control view), the derived HIGH_RISK attention flag and Control Center tile, and the agents-list risk filter. Preserved: Risk Scanner (lib/scanner, /scan, /risk-scan), Agent.riskLevel as configuration (edit form, policy/decision floor), per-event/policy/approval/incident risk levels, the shadow risk engine on evaluations. Guarded by lib/__tests__/no-agent-risk-score.test.ts and components/console/__tests__/agent-node.test.tsx.
