import "server-only";

import { getPlan, PLANS, type PlanId, type PlanConfig } from "@/lib/billing/plans";

/**
 * A discriminated result, not a bare boolean, so every call site can show
 * the caller *why* and *what to do about it* — never a silent no-op.
 * Deliberately takes plan id + current counts as plain arguments (not an
 * Organization/Prisma type) so this stays pure and unit-testable without a
 * database; callers query the current count themselves.
 */
export type EntitlementResult =
  | { allowed: true }
  | { allowed: false; reason: string; upgradeTo?: PlanId };

const PLAN_ORDER: PlanId[] = ["free", "startup", "growth", "business", "enterprise"];

/** The cheapest plan (above the current one) that actually raises the given limit — used to make the upgrade prompt concrete rather than generic. */
function nextPlanWithHigherLimit(currentId: PlanId, limitKey: "agentLimit" | "memberLimit" | "apiKeyLimit"): PlanId | undefined {
  const currentLimit = PLANS[currentId][limitKey];
  const startIndex = PLAN_ORDER.indexOf(currentId) + 1;
  for (let i = startIndex; i < PLAN_ORDER.length; i++) {
    const candidate = PLANS[PLAN_ORDER[i]];
    const candidateLimit = candidate[limitKey];
    if (candidateLimit === null || (currentLimit !== null && candidateLimit > currentLimit)) {
      return candidate.id;
    }
  }
  return undefined;
}

function limitResult(
  plan: PlanConfig,
  limitKey: "agentLimit" | "memberLimit" | "apiKeyLimit",
  currentCount: number,
  noun: string
): EntitlementResult {
  const limit = plan[limitKey];
  if (limit === null || currentCount < limit) return { allowed: true };
  return {
    allowed: false,
    reason: `The ${plan.name} plan is limited to ${limit} ${noun}${limit === 1 ? "" : "s"}. Upgrade to add more.`,
    upgradeTo: nextPlanWithHigherLimit(plan.id, limitKey),
  };
}

export function canCreateAgent(planId: string | null | undefined, currentAgentCount: number): EntitlementResult {
  return limitResult(getPlan(planId), "agentLimit", currentAgentCount, "agent");
}

export function canInviteMember(planId: string | null | undefined, currentMemberCount: number): EntitlementResult {
  return limitResult(getPlan(planId), "memberLimit", currentMemberCount, "member");
}

export function canCreateApiKey(planId: string | null | undefined, currentApiKeyCount: number): EntitlementResult {
  return limitResult(getPlan(planId), "apiKeyLimit", currentApiKeyCount, "API key");
}

export function canCreateWebhook(planId: string | null | undefined): EntitlementResult {
  const plan = getPlan(planId);
  if (plan.webhooks) return { allowed: true };
  return {
    allowed: false,
    reason: `Webhooks aren't available on the ${plan.name} plan.`,
    upgradeTo: "startup",
  };
}

export function canUseAdvancedPolicies(planId: string | null | undefined): EntitlementResult {
  const plan = getPlan(planId);
  if (plan.advancedPolicies) return { allowed: true };
  return {
    allowed: false,
    reason: `Conditional/advanced policies aren't available on the ${plan.name} plan.`,
    upgradeTo: "startup",
  };
}

export function canExportAudit(planId: string | null | undefined): EntitlementResult {
  const plan = getPlan(planId);
  if (plan.auditExport) return { allowed: true };
  return {
    allowed: false,
    reason: `Audit log export isn't available on the ${plan.name} plan.`,
    upgradeTo: "growth",
  };
}
