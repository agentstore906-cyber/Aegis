-- Replace the Stripe billing integration with Lemon Squeezy.
--
-- Non-destructive to real data: the dropped columns and the renamed table
-- only ever held Stripe subscription state, which is null/empty until a
-- checkout completes and no organization has completed one. The
-- provider-neutral columns (subscriptionStatus, currentPeriodEnd,
-- cancelAtPeriodEnd, plan) are kept as-is.

-- Organization: drop Stripe id columns, add Lemon Squeezy equivalents + period fields.
ALTER TABLE "organizations" DROP COLUMN "stripeCustomerId";
ALTER TABLE "organizations" DROP COLUMN "stripeSubscriptionId";

ALTER TABLE "organizations" ADD COLUMN "lemonSqueezyCustomerId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "lemonSqueezySubscriptionId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "lemonSqueezyVariantId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "billingInterval" TEXT;
ALTER TABLE "organizations" ADD COLUMN "currentPeriodStart" TIMESTAMP(3);

-- Webhook-dedup table: same shape, provider-neutral name.
ALTER TABLE "stripe_webhook_events" RENAME TO "billing_webhook_events";
ALTER TABLE "billing_webhook_events" RENAME CONSTRAINT "stripe_webhook_events_pkey" TO "billing_webhook_events_pkey";
