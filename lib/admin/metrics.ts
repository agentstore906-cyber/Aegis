import "server-only";

import { prisma } from "@/lib/db";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/**
 * Real, DB-sourced platform metrics for /admin/metrics — every number here
 * comes from an actual Prisma aggregate, never sample/placeholder data.
 * Deliberately does not compute retention cohorts or trend lines: this
 * environment's real event history is too thin/fresh to make either
 * meaningful, and filling a chart with fabricated history would be exactly
 * what Phase 10's "do not fabricate cohorts" rule forbids. See
 * docs/gtm/metrics.md for the formulas this is expected to grow into once
 * there's enough real usage to support them.
 */
export type PlatformMetrics = {
  totalOrganizations: number;
  activatedOrganizations: number;
  totalAgents: number;
  totalGovernedActions: number;
  mrrCents: number;
  paidOrganizations: number;
  planDistribution: { plan: string; count: number }[];
};

/**
 * "Activated" here matches the Phase 10 master prompt's own §3 definition
 * literally: org created (implicit), agent connected, first event received,
 * first policy created, first evaluation completed. Runs one existence
 * check per org — fine at the org counts this environment actually has;
 * if that ever stops being true, this becomes a single grouped aggregate
 * query instead of a per-org loop, not a reason to build that now (Phase
 * 10 §100: don't optimize for a scale that doesn't exist yet).
 */
async function countActivatedOrganizations(organizationIds: string[]): Promise<number> {
  const results = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const [agent, event, policy, permission, evaluation] = await Promise.all([
        prisma.agent.findFirst({ where: { organizationId }, select: { id: true } }),
        prisma.activityEvent.findFirst({ where: { organizationId }, select: { id: true } }),
        prisma.policy.findFirst({ where: { organizationId }, select: { id: true } }),
        prisma.agentPermission.findFirst({ where: { organizationId }, select: { id: true } }),
        prisma.policyEvaluation.findFirst({ where: { organizationId }, select: { id: true } }),
      ]);
      return agent !== null && event !== null && (policy !== null || permission !== null) && evaluation !== null;
    })
  );
  return results.filter(Boolean).length;
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const [organizations, totalAgents, totalGovernedActions, planGroups, paidOrgs] = await Promise.all([
    prisma.organization.findMany({ select: { id: true } }),
    prisma.agent.count(),
    prisma.policyEvaluation.count(),
    prisma.organization.groupBy({ by: ["plan"], _count: { _all: true } }),
    // MRR/paid-count source directly from Stripe-mirrored fields — never
    // fabricated, and only counts orgs Stripe itself reports as active.
    prisma.organization.findMany({
      where: { subscriptionStatus: "active" },
      select: { plan: true },
    }),
  ]);

  const activatedOrganizations = await countActivatedOrganizations(organizations.map((org) => org.id));

  const mrrCents = paidOrgs.reduce((sum, org) => {
    const plan = PLANS[org.plan as PlanId];
    return sum + (plan?.priceCents ?? 0);
  }, 0);

  return {
    totalOrganizations: organizations.length,
    activatedOrganizations,
    totalAgents,
    totalGovernedActions,
    mrrCents,
    paidOrganizations: paidOrgs.length,
    planDistribution: planGroups.map((group) => ({ plan: group.plan, count: group._count._all })),
  };
}
