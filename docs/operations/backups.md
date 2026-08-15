# Backups

**Aegis does not implement its own backup mechanism.** This document is the
process/ownership companion to `docs/deployment.md`'s
[§Backups](../deployment.md#backups), which covers the technical fact; this
page covers who is responsible for what, and how to actually verify a backup
is real before you need it.

## What exists today

Nothing, application-side. Backup/point-in-time-recovery (PITR) is entirely a
function of whichever managed Postgres provider a deployment uses (Neon,
Supabase, RDS, Railway, etc.). Most of them offer automated daily backups
and/or continuous PITR on paid tiers — **none of that is enabled by
default just because a database exists.**

## Who is responsible

The deployment owner (whoever provisions `DATABASE_URL` for a given
environment), not the application. This repo has no infrastructure-as-code
or backup-configuration step of its own to hand that responsibility to.

## Before going to production, confirm

1. Your Postgres provider's specific backup plan is enabled (not just
   "available on this tier" — some providers require an explicit opt-in or
   a paid tier).
2. The backup/PITR retention window (how far back you can restore) meets
   your actual requirement — this is a business decision Aegis has no
   opinion on and doesn't enforce.
3. **You have actually performed a test restore**, not just confirmed
   backups exist. A backup that has never been restored is unverified.
   Do this against a throwaway database, not production.
4. Restoring the database is the entire recovery unit — Aegis has no
   separate object storage, file uploads, or external state to back up
   alongside Postgres (see `docs/deployment.md` for the full list of what
   this app depends on).

## What restoring actually gives you back

A point-in-time snapshot of every table, including `AuditEvent` (the
append-only audit trail), `ApiKey` (hashes only — a restore never leaks raw
keys), and `StripeWebhookEvent` (the Stripe idempotency ledger — see
`docs/deployment.md#6-stripe-webhook-configuration` for why replayed events
after a restore are still handled safely). See
`docs/operations/disaster-recovery.md` for what happens between "database
goes down" and "database is restored."

## Not implemented, and out of scope for this repo to add unilaterally

- Automated backup scheduling (a provider concern, not an application one).
- Cross-region replication or failover.
- Any backup mechanism for anything other than Postgres — there is nothing
  else stateful in this deployment (no object storage, no separate cache
  with durable state).
