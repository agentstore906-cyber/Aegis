# Real agents: one canonical identity for Scan and Connect

## Audit (before any change)

**1. How a real agent is identified.** The strongest existing identity is the **credential bound to the agent**: an `ApiKey` with `agentId` set (`keyHash` unique, org-scoped, revocable, optionally expiring). A request authenticated with it is the only thing that moves a connection out of "waiting" (`lib/agents/handshake.ts`: `recordHandshake` / `touchConnection`). The agent is *the key's agent*; the request body cannot name one, org-wide keys cannot handshake (403), and `firstHandshakeAt` / `lastSeenAt` record the contact. The canonical record is the `Agent` row (`id`, unique per `(organizationId, slug)`), tied to its `AgentConnection` (1:1). Display name and slug are labels, not identity. (`POST /api/v1/agents/register` is an upsert-by-name for an org-wide key; that is organization-level authority, not agent identity.)

**2. Does Scan Agent talk to a real agent?** No (before this change). `RiskScan` is a questionnaire: the user ticks capabilities, autonomy and controls, and a deterministic engine scores the answers. Nothing about an agent is observed. Its only link to an agent was `connectedAgentId`, picked by the user from a dropdown (same-organization check only).

**3. Does Connect Agent talk to a real agent?** Yes. Creating the record yields a *pending* agent (`CONNECTING`, derived state `WAITING`); it becomes `CONNECTED` only on a request authenticated with the bound credential. Verified end to end in a real browser with a real SDK process (docs/AEGIS_PRODUCTION_GATE.md).

**4. Same canonical identity?** No. Scan had no agent; Connect had one; the optional manual link let a never-contacted placeholder row stand in for "the agent".

**5. Where fake / UI-created agents could appear.**
- Retrying "Connect" with the same name minted a **new** pending agent each time (`ensureUniqueAgentSlug` → `name-1`, `name-2`): duplicate identities for one real agent.
- `linkScanToAgent` accepted any agent row in the organization, including one that had never made contact.
- Scan results were not tied to an agent at all.
- (Unchanged, by design) the "Explore Demo" sample workspace and `register()` for org-wide keys.

**6. Root cause.** The scanner was built as a pre-sign-up questionnaire that is independent of agent identity, and the Connect wizard treated "a name was typed" as sufficient to create a record each time.

**7. Minimal change.** Keep the SDK, handshake, credentials and connection state exactly as they are. Make "real" mean *contact evidence*, and make Scan consume that same evidence.

## What changed
- **Scan of a real agent** (`lib/scanner/agent-scan*.ts`, `AgentSecurityScan` table, migration `20261013120000_agent_security_scans`, panel on the agent's Security tab, "Scan this agent" after Connect). Allowed **only** while the backend reports the agent `CONNECTED` with a first handshake. Waiting, revoked, errored or long-silent agents are refused with the reason. The scan reads stored evidence (identity assurance, grants, policies, decision coverage, ran-despite, alerts, deviations, keys) and runs read-only policy probes (`simulateAgentAction`: no writes, the agent is not contacted). Every finding is labelled *observed* or *tested* and cites its evidence; there is **no score**. Results are stored against the canonical `agentId`, scoped by organization. The result states what was not tested (prompts, code, model).
- **No duplicate identities**: Connect for a name whose agent is still pending (CUSTOM_SDK, `CONNECTING`, never contacted) reuses that record and issues a fresh credential (the unused one is revoked) instead of creating another agent. An agent that has connected is never merged with a new attempt.
- **Scan link guard**: a questionnaire scan can be linked only to an agent that has really connected.

## Not changed (and why)
- The public questionnaire at `/scan` and `/risk-scan` still exists and still shows its own report. It is a self-assessment of answers the visitor provides; it is not a scan of a real agent and cannot be (an anonymous visitor has no agent). Whether to relabel or retire it is a product decision.
- Active attacks on the agent itself (prompt-injection probes etc.) would need an endpoint or SDK hook the agent exposes; none exists, and none was invented.

## Tests
`lib/__tests__/real-agent-identity.integration.test.ts` (16): pending ≠ connected, no scan without contact, real handshake then scan on the same `Agent` row, connect→scan and scan→connect, duplicate Connect attempts, idempotent handshake, revoked and expired credentials (before and after connecting), organization isolation (same slug in two organizations), cross-agent and cross-organization substitution, org-wide key refusal. Mutation-checked: disabling the contact requirement fails 8 of them. Plus `components/security/__tests__/agent-scan-panel.test.tsx` (4) and `lib/scanner/__tests__/service.integration.test.ts` (link guard).

## Addendum: Free Risk Scanner is the real-agent scanner
The questionnaire scanner is retired. /risk-scan (signed in) lists only this organization's genuinely connected agents and uses the same Scan Agent implementation (AgentScanPanel / runAgentScan) as the agent's Security tab; /scan (public) explains the real-agent scan and sends visitors to Connect Agent (signed-in visitors are redirected to /risk-scan). Old /scan/report|r|connect/*, /risk and /risk-scan/:id redirect (next.config); POST /api/scan returns 410. Retry of Connect for a still-pending agent is resolved before the new-agent plan-limit check. Legacy RiskScan rows and lib/scanner engine code are retained but unreachable from the UI.
