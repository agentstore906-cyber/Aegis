import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewBilling, canManageBilling } from "@/lib/billing/authorization";
import { getPlan } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/paddle";
import { buildAuthenticatedPlanCtas } from "@/lib/billing/upgrade-ctas";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { PaddleCheckoutProvider } from "@/components/settings/paddle-checkout-provider";
import { BillingPortalButton } from "@/components/settings/billing-portal-button";
import { BillingCancelButton } from "@/components/settings/billing-cancel-button";
import { UsageBar } from "@/components/billing/usage-bar";

export const metadata: Metadata = { title: "Billing" };

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  trialing: "success",
  past_due: "warning",
  paused: "warning",
  cancelled: "danger",
  expired: "danger",
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  if (!canViewBilling(role)) notFound();

  const { checkout } = await searchParams;

  const [agentCount, memberCount, apiKeyCount] = await Promise.all([
    prisma.agent.count({ where: { organizationId: organization.id } }),
    prisma.organizationMember.count({ where: { organizationId: organization.id } }),
    prisma.apiKey.count({ where: { organizationId: organization.id, revokedAt: null } }),
  ]);

  const plan = getPlan(organization.plan);
  const configured = isBillingConfigured();
  const canManage = canManageBilling(role);
  const hasSubscription = Boolean(organization.paddleSubscriptionId);

  const planCtas = buildAuthenticatedPlanCtas({ currentPlanId: plan.id, configured, canManage, hasSubscription });

  const plansSection = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The same plans, prices, and features shown on our{" "}
          <a href="/pricing" className="underline">
            public pricing page
          </a>
          .
        </p>
      </div>
      <PricingPlans ctaByPlanId={planCtas} currentPlanId={plan.id} />
      <p className="text-xs text-muted-foreground">
        Payments are processed by Paddle, our Merchant of Record, via a secure checkout overlay. Aegis
        never stores your card details. New checkouts and cancellations take effect once Paddle&rsquo;s
        confirmation webhook reaches Aegis.
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Billing" description={`${organization.name}'s plan and usage.`} />

        {checkout === "success" && (
          <Alert tone="info">
            Payment received. We&rsquo;re confirming your subscription with Paddle — this page will show
            the new plan within a minute. You can safely refresh.
          </Alert>
        )}

        {!configured && (
          <Alert tone="info">
            Billing is not configured in this environment — no Paddle credentials are set. Plan limits
            are still enforced below; subscribing requires a deployment with <code>PADDLE_API_KEY</code>{" "}
            configured. See docs/deployment.md.
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-foreground">{plan.name}</p>
                  {organization.subscriptionStatus && (
                    <Badge tone={STATUS_TONE[organization.subscriptionStatus] ?? "neutral"}>
                      {organization.subscriptionStatus.replace("_", " ")}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.priceCents === null ? "Custom pricing" : `${formatCurrency(plan.priceCents)}/month`}
                </p>
                {organization.currentPeriodEnd && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {organization.cancelAtPeriodEnd ? "Access ends" : "Renews"}{" "}
                    {formatDateTime(organization.currentPeriodEnd)}
                  </p>
                )}
                {organization.cancelAtPeriodEnd && (
                  <p className="mt-2 text-xs font-medium text-warning">
                    Cancellation scheduled — you&rsquo;ll keep {plan.name} access until then.
                  </p>
                )}
              </div>
              {canManage && hasSubscription && configured && (
                <div className="flex items-center gap-2">
                  <BillingPortalButton />
                  {!organization.cancelAtPeriodEnd && <BillingCancelButton />}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar label="Agents" used={agentCount} limit={plan.agentLimit} />
            <UsageBar label="Members" used={memberCount} limit={plan.memberLimit} />
            <UsageBar label="Active API keys" used={apiKeyCount} limit={plan.apiKeyLimit} />
          </CardContent>
        </Card>
      </div>

      {canManage ? <PaddleCheckoutProvider>{plansSection}</PaddleCheckoutProvider> : plansSection}
    </div>
  );
}
