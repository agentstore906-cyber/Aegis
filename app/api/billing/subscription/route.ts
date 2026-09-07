import { NextResponse } from "next/server";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canViewBilling } from "@/lib/billing/authorization";
import { getPlan } from "@/lib/billing/plans";

/**
 * Returns the caller's own organization's current subscription state.
 * Session-authenticated (same auth as every dashboard page, via
 * `requireActiveOrganization`) — this is not part of the public
 * API-key-authenticated surface under `/api/v1`. Never accepts an
 * organization id from the caller: the organization is always the one
 * resolved from the signed-in session.
 */
export async function GET() {
  const { organization, role } = await requireActiveOrganization();

  if (!canViewBilling(role)) {
    return NextResponse.json({ error: "You don't have permission to view billing." }, { status: 403 });
  }

  const plan = getPlan(organization.plan);

  return NextResponse.json({
    plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents },
    subscriptionStatus: organization.subscriptionStatus,
    currentPeriodStart: organization.currentPeriodStart,
    currentPeriodEnd: organization.currentPeriodEnd,
    cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
    hasPaddleSubscription: Boolean(organization.paddleSubscriptionId),
  });
}
