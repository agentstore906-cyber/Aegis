# Security incident checklist

The actionable checklist version of `docs/security/incident-response.md` —
use this during an actual incident; read the other doc for the reasoning
behind each step.

- [ ] **Detect** — report received (responsible disclosure or internal
      observation) or anomaly noticed.
- [ ] **Confirm** — reproduced, or corroborated with `AuditEvent`/log
      evidence. Severity classified (tenant isolation / privilege escalation
      / secret exposure vs. lower severity).
- [ ] **Contain**
  - [ ] Revoke any compromised API key(s) — immediate, checked on every
        request (`lib/api-keys/service.ts`'s `authenticateApiKey`).
  - [ ] Force password reset / rotate `AUTH_SECRET` if a credential or
        session mechanism is compromised (rotating `AUTH_SECRET` signs
        everyone out — expected).
  - [ ] If a specific org/key is the vector, disable/revoke that scope
        before considering a broader outage — narrowest effective
        containment first.
- [ ] **Preserve logs** — export/copy relevant `AuditEvent` rows and
      platform logs for the incident window before remediation touches them.
- [ ] **Assess scope** — which organizations/users/agents/keys were
      *actually* affected, using the preserved evidence — not assumed from
      the vulnerability's theoretical reach.
- [ ] **Rotate credentials if required** — any credential plausibly in scope,
      even if not confirmed compromised, if the cost of rotating is low
      relative to the risk.
- [ ] **Notify affected parties if required** — manual today; determine
      legal/contractual obligation per jurisdiction/contract (this repo has
      no automated notification path).
- [ ] **Recover** — fix deployed via the normal release process (don't skip
      `tsc`/lint/tests under pressure); restore from backup only if data was
      actually lost, not by default.
- [ ] **Review**
  - [ ] Root cause documented in plain terms.
  - [ ] Regression test added where practical (this codebase already does
        this for tenant isolation, approvals, API keys, and webhook
        verification — extend that pattern, don't start a new one).
  - [ ] Docs updated if the finding changes what `/trust`,
        `docs/security/questionnaire.md`, or this checklist claim.

## What this checklist is not

Not a substitute for judgment under a real incident, and not a claim that
every step above has tooling behind it — several are manual by design (see
`docs/security/incident-response.md`'s "What this deliberately doesn't
claim"). Don't automate a dangerous containment action (e.g. auto-revoking
keys off an unverified signal) without the explicit justification that would
require — a false-positive lockout is its own incident.
