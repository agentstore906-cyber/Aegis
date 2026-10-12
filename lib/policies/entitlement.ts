import "server-only";

import type { PrismaOrTx } from "@/lib/db";
import { canUseAdvancedPolicies } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";

/**
 * "Advanced policies" = policies with conditions (field/operator/value tests on the request context). A policy
 * scoped only by agent / action / resource / environment / tool / risk level is a basic policy and is available on
 * every plan. See `canUseAdvancedPolicies` (lib/billing/entitlements.ts) for which plans include the feature.
 */
export function policyUsesAdvancedFeatures(input: { conditions: readonly unknown[] }): boolean {
  return input.conditions.length > 0;
}

/** Thrown by the policy repository when a plan does not include what the policy would save or enable. */
export class AdvancedPolicyNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvancedPolicyNotAllowedError";
  }
}

/**
 * Throws `AdvancedPolicyNotAllowedError` (with an upgrade message) if the organization's plan does not include
 * advanced policies and `usesAdvancedFeatures` is true. Enforced in the repository so every caller — server action,
 * future API route, job — is covered; the UI only mirrors it.
 */
export async function assertAdvancedPolicyAllowed(client: PrismaOrTx, organizationId: string, usesAdvancedFeatures: boolean): Promise<void> {
  if (!usesAdvancedFeatures) return;
  const organization = await client.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true } });
  const denial = advancedPolicyDenial(organization.plan);
  if (denial) throw new AdvancedPolicyNotAllowedError(denial);
}

function denialParts(planId: string | null | undefined): { reason: string; upgrade: string } | null {
  const result = canUseAdvancedPolicies(planId);
  if (result.allowed) return null;
  return {
    reason: result.reason,
    upgrade: result.upgradeTo ? `Upgrade to the ${PLANS[result.upgradeTo].name} plan to add conditions to policies.` : "",
  };
}

/** The full user-facing refusal (reason + upgrade hint) for a plan, or null when the plan includes advanced policies. */
export function advancedPolicyDenial(planId: string | null | undefined): string | null {
  const parts = denialParts(planId);
  return parts ? [parts.reason, parts.upgrade].filter(Boolean).join(" ") : null;
}

/**
 * What the policy form shows when the plan has no conditions. `canUpgrade` (from `canAccessUpgradePage`) decides
 * whether the viewer gets a link or is told who can upgrade — a link to a page that would 404 is never offered.
 */
export function policyConditionsLock(planId: string | null | undefined, canUpgrade: boolean): { message: string; canUpgrade: boolean } | undefined {
  const parts = denialParts(planId);
  if (!parts) return undefined;
  return { message: parts.reason, canUpgrade };
}
