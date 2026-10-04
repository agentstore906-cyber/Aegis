import "server-only";

import type { Prisma } from "@prisma/client";

import { canCreateAgent, type EntitlementResult } from "@/lib/billing/entitlements";

/**
 * The plan's agent limit, checked race-safely (P0 §8). Must be called inside
 * the same transaction that creates the agent: a transaction-scoped advisory
 * lock per organization serializes concurrent creations, so two requests at
 * `limit - 1` can't both count, both pass, and both create. Every agent-
 * creating path (dashboard connect flow, POST /api/v1/agents/register) goes
 * through here — the limit can't be bypassed by choosing a different door.
 */
export async function checkAgentLimitLocked(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<EntitlementResult> {
  const lockKey = `agent_create:${organizationId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  const [agentCount, organization] = await Promise.all([
    tx.agent.count({ where: { organizationId } }),
    tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true } }),
  ]);
  return canCreateAgent(organization.plan, agentCount);
}

export class AgentLimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLimitReachedError";
  }
}
