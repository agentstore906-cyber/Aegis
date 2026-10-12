-- Billing event ordering + downgrade retention grace (additive, nullable, no backfill).
--
-- billingEventAt    newest applied subscription.* event time (Paddle occurred_at); stale events are ignored.
-- paymentEventAt    newest applied transaction.* event time.
-- planDowngradedAt  when Aegis applied a paid -> free downgrade; starts the 14-day retention grace period.
--
-- All three are NULL for every existing organization: "no ordering known yet" (the first event applies) and
-- "not recently downgraded" (normal retention behavior). Nothing is rewritten or deleted.
ALTER TABLE "organizations"
  ADD COLUMN "billingEventAt" TIMESTAMP(3),
  ADD COLUMN "paymentEventAt" TIMESTAMP(3),
  ADD COLUMN "planDowngradedAt" TIMESTAMP(3);
