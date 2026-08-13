# Retention (Phase 5)

**Nothing is automatically deleted today.** This document exists so that
never becomes an ambiguous claim.

## What exists

`Organization.activityRetentionDays`, `.auditRetentionDays`,
`.securityRetentionDays` — nullable integers, configurable from
`/settings/organization`'s Retention card. `null` means "no configured
limit," not "delete immediately." These are pure configuration values;
nothing in the application reads them to decide what to delete.

## Why enforcement isn't built yet

Actually deleting data on a schedule needs a scheduler or background-job
runner. None exists in this environment (spec §21/§56: "if lifecycle jobs
are not available, implement configuration + clear documentation and
leave background retention execution for later" / "do not pretend
scheduled jobs run if no scheduler is configured"). Building one just for
this would be exactly the kind of infrastructure over-reach spec §58 rules
out ("No overbuilding... Kafka pipeline" and friends apply in spirit here
too — a bespoke scheduler for one feature is the same mistake at smaller
scale).

## What "enforcing this" would take later

1. A scheduled execution path (a real cron/worker, or a platform-level
   scheduled invocation) that runs at most once a day per organization.
2. A deletion query scoped by `organizationId` and the configured
   `*RetentionDays`, batched (not a single unbounded `DELETE`) to avoid
   long-held locks on `ActivityEvent`/`AuditEvent`/`SecurityAlert`.
3. An audit trail for the deletion itself — deleting audit/security data
   is exactly the kind of action that should leave a record that it
   happened, even though the deleted rows themselves are gone.
4. Explicit handling for `AuditEvent`: it's documented elsewhere in this
   codebase as append-only from the application's perspective. Retention
   deletion would be the one sanctioned exception, and should be
   implemented as its own clearly-named function, not a generic delete
   path that could be reused to quietly edit audit history.

None of this exists yet. The UI's Retention card says so explicitly,
rather than implying otherwise.
