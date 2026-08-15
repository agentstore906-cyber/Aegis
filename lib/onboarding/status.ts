import "server-only";

import { prisma } from "@/lib/db";

export type OnboardingStep =
  | "agentConnected"
  | "firstEventReceived"
  | "firstPolicyCreated"
  | "firstEvaluationCompleted"
  | "approvalWorkflowUsed"
  | "teammateInvited";

export type OnboardingStatus = Record<OnboardingStep, boolean> & { complete: boolean };

/**
 * Auto-detected onboarding progress — every step is derived from real,
 * already-org-scoped data, never a manually-checked box (see
 * components/dashboard/onboarding-checklist.tsx). Each check is a bounded
 * `findFirst` (stops at the first row via the model's existing
 * `organizationId` index) rather than a `count()`, since we only need
 * existence, not a total.
 *
 * Deliberately excludes "review security"/"review cost" — this codebase
 * has no page-visit tracking, and adding one just to check a box would be
 * disproportionate to what this checklist needs.
 */
export async function getOnboardingStatus(organizationId: string): Promise<OnboardingStatus> {
  const [agent, event, policy, permission, evaluation, approval, memberCount, invitation] = await Promise.all([
    prisma.agent.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.activityEvent.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.policy.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.agentPermission.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.policyEvaluation.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.approvalRequest.findFirst({ where: { organizationId }, select: { id: true } }),
    prisma.organizationMember.count({ where: { organizationId } }),
    prisma.organizationInvitation.findFirst({ where: { organizationId }, select: { id: true } }),
  ]);

  const steps: Record<OnboardingStep, boolean> = {
    agentConnected: agent !== null,
    firstEventReceived: event !== null,
    firstPolicyCreated: policy !== null || permission !== null,
    firstEvaluationCompleted: evaluation !== null,
    approvalWorkflowUsed: approval !== null,
    teammateInvited: memberCount > 1 || invitation !== null,
  };

  return { ...steps, complete: Object.values(steps).every(Boolean) };
}
