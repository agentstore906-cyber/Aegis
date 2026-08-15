# Incident response

`docs/security/questionnaire.md` previously said plainly that no formal
incident-response process was published for this product. This document is
that process — scoped honestly to what a small team can actually execute
today, not an on-call rotation or SLA structure that doesn't exist yet. If
your organization requires a more formal IR program (dedicated on-call,
contractual response-time SLAs, a status page), that's a real gap — see
"What this deliberately doesn't claim" below.

This covers **security incidents in the Aegis product/infrastructure
itself** — not policy decisions Aegis made about a customer's AI agent
(that's `docs/policy-engine.md` and `docs/security-intelligence.md`'s
territory, and is customer-facing via `/security` and `/audit`).

## How a report reaches the team

Via responsible disclosure (`/trust` on the marketing site,
`docs/security/questionnaire.md`) — an email report of a suspected issue,
or internal detection (see below).

## 1. Detection

Sources today:
- External report via the responsible-disclosure contact.
- Internal observation — an anomaly in `AuditEvent`/`SecurityAlert` data, an
  unexpected pattern in access logs, or a report from a customer.
- **Not automated**: there's no SIEM, IDS, or automated anomaly alerting
  over Aegis's own infrastructure (as distinct from `SecurityAlert`, which
  detects risky *agent* behavior for customers — see
  `docs/security-intelligence.md`). Detection of an incident against Aegis
  itself is currently manual/report-driven.

## 2. Confirm

Before treating a report as a real incident:
- Reproduce it, or find corroborating evidence (relevant `AuditEvent` rows,
  server logs, the reporter's proof-of-concept).
- Classify severity: does it expose one organization's data to another
  (tenant isolation break), allow privilege escalation, expose secrets
  (API keys, session tokens, Stripe credentials), or is it lower-severity
  (e.g. a rate-limit bypass, a non-sensitive info leak)?

## 3. Contain

Depends on what's confirmed:
- **Compromised credentials** (a leaked API key, a compromised user
  password): revoke the API key (`/developers/api-keys` or directly via
  `lib/api-keys/actions.ts`'s revoke path — this takes effect immediately,
  checked on every request in `withApiAuth`); force a password reset for the
  affected user.
- **Compromised `AUTH_SECRET`**: rotate it. This invalidates every existing
  JWT session immediately (everyone is signed out) — the correct
  fail-closed outcome, not a side effect to work around.
- **A code-level vulnerability** (e.g. a tenant-isolation gap): the fix is a
  code change — follow `docs/operations/release-process.md`'s checklist to
  ship it as fast as safely possible; don't skip `npx tsc --noEmit`/tests
  under incident pressure, since a rushed, broken fix is a second incident.
- **A live exploitation in progress**: if a specific organization/API key is
  the vector, revoking that key/disabling that account is faster and safer
  than taking the whole app down. Taking Aegis fully offline is a last
  resort given it's the control plane customers rely on for their own
  agents' decisions.

## 4. Preserve evidence

- `AuditEvent` rows relevant to the incident — this table is append-only
  from the application's perspective (nothing in normal application code
  updates or deletes it), so it's already a reliable record. Export/copy
  the relevant rows before any remediation that might touch them.
- Server/platform logs for the incident window, if your deployment platform
  retains them (Aegis itself doesn't ship its own log-retention system —
  see `docs/deployment.md`).
- The original report and reproduction steps.

## 5. Assess scope

Using the preserved evidence: which organizations, users, agents, or API
keys were actually affected — not just "could theoretically have been."
Tenant-isolation findings should be checked against the audit trail for
actual cross-tenant access, not assumed from the vulnerability's existence
alone.

## 6. Notify affected parties, if required

If customer data was actually accessed/exposed (not just theoretically
reachable), affected organizations should be notified with what's known:
what happened, what data, what's been done about it. This repo has no
automated notification mechanism — this is a manual communication, and
whether it's legally required depends on your jurisdiction and the
customer's contract, which this document can't determine for you.

## 7. Recover

- Confirm the fix is deployed and verified (rerun the relevant negative
  test — see `docs/security/security-incident-checklist.md`).
- Rotate any credential that was in scope of the incident, even if not
  confirmed compromised, if rotation is cheap relative to the risk.
- Restore from backup only if data was actually lost/corrupted, not as a
  default incident-closing step — see `docs/operations/backups.md` and
  `docs/operations/disaster-recovery.md`.

## 8. Post-incident review

- What allowed it, in plain terms.
- What the fix was.
- Whether it needs a regression test (add one — see
  `docs/security/security-incident-checklist.md`'s "every discovered
  security issue gets a regression test where practical" — this is the
  actual practice this codebase already follows for approvals, tenant
  isolation, API keys, and webhook verification; a new finding should join
  that pattern).
- Whether it needs a documentation update (this file, `/trust`,
  `docs/security/questionnaire.md`).

## What this deliberately doesn't claim

- No dedicated on-call rotation.
- No contractual incident-response time SLA.
- No status page or automated customer notification system.
- No SIEM/automated intrusion detection over Aegis's own infrastructure.

If any of the above becomes a real requirement, it needs an explicit
decision and real tooling — not a claim added to this document ahead of it
actually existing.
