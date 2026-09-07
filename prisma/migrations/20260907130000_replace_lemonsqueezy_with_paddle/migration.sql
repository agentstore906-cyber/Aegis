-- Replace the Lemon Squeezy billing integration with Paddle Billing.
--
-- Non-destructive to real data: these are pure renames, so any organization
-- that already has a Lemon Squeezy customer/subscription id keeps that value
-- under its new column name (it will simply no longer resolve against a live
-- Paddle account — expected, since this is a provider swap). The
-- provider-neutral columns (subscriptionStatus, billingInterval,
-- currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, plan) are
-- untouched.

ALTER TABLE "organizations" RENAME COLUMN "lemonSqueezyCustomerId" TO "paddleCustomerId";
ALTER TABLE "organizations" RENAME COLUMN "lemonSqueezySubscriptionId" TO "paddleSubscriptionId";
ALTER TABLE "organizations" RENAME COLUMN "lemonSqueezyVariantId" TO "paddlePriceId";
