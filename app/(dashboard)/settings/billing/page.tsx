import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewBilling, canManageBilling } from "@/lib/billing/authorization";
import { getPlan, PLANS, type PlanId } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/lemonsqueezy";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { BillingUpgradeButton } from "@/components/settings/billing-upgrade-button";
import { BillingPortalButton } from "@/components/settings/billing-portal-button";
import { UsageBar } from "@/components/billing/usage-bar";

export const metadata: Metadata = { title: "Billing" };

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  trialing: "success",
  past_due: "warning",
  paused: "warning",
  unpaid: "danger",
  cancelled: "neutral",
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
  const hasSubscription = Boolean(organization.lemonSqueezySubscriptionId);
  const otherPlans = (Object.keys(PLANS) as PlanId[])
    .filter((id) => id !== plan.id && id !== "enterprise")
    .map((id) => PLANS[id]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Billing" description={`${organization.name}'s plan and usage.`} />

      {checkout === "success" && (
        <Alert tone="info">
          Payment received. We&rsquo;re confirming your subscription with Lemon Squeezy — this page
          will show the new plan within a minute. You can safely refresh.
        </Alert>
      )}
      {checkout === "cancelled" && (
        <Alert tone="warning">Checkout was cancelled — your plan hasn&rsquo;t changed.</Alert>
      )}

      {!configured && (
        <Alert tone="info">
          Billing is not configured in this environment — no Lemon Squeezy credentials are set. Plan
          limits are still enforced below; subscribing requires a deployment with{" "}
          <code>LEMONSQUEEZY_API_KEY</code> configured. See docs/deployment.md.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
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
            </div>
            {canManage && hasSubscription && configured && <BillingPortalButton />}
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

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{hasSubscription ? "Change plan" : "Subscribe"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {otherPlans.map((candidate) => (
                <div key={candidate.id} className="rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold text-foreground">{candidate.name}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {candidate.priceCents === null ? "Custom" : formatCurrency(candidate.priceCents)}
                    {candidate.priceCents !== null && (
                      <span className="text-xs font-normal text-muted-foreground">/mo</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {candidate.agentLimit ?? "Unlimited"} agents · {candidate.memberLimit ?? "Unlimited"} members
                  </p>
                  <div className="mt-3">
                    {configured && candidate.lemonSqueezyVariantId ? (
                      <BillingUpgradeButton
                        planId={candidate.id}
                        label={`Subscribe to ${candidate.name}`}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Contact us to upgrade.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Payments are processed by Lemon Squeezy. Your plan changes once their confirmation
              webhook reaches Aegis — not on the redirect back from checkout.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
