import "server-only";

import type { AgentTrustTransition, Prisma, TrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { defer } from "@/lib/server/defer";
import { TRUST_METHODOLOGY_VERSION } from "@/lib/trust/config";
import { gatherTrustEvidence } from "@/lib/trust/evidence";
import { computeTrust, describeTransition, isMeaningfulChange } from "@/lib/trust/score";
import type { TrustEvaluationOptions, TrustFactor, TrustLimit, TrustSnapshot } from "@/lib/trust/types";

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

export type TrustEvaluation = {
  state: TrustState;
  score: number;
  /** True when this evaluation appended a history row. */
  recorded: boolean;
  transition: AgentTrustTransition | null;
};

/**
 * Re-computes an agent's trust from its current evidence and, when the change
 * is meaningful, appends a transition with the reasons.
 *
 * Idempotent and order-independent: the result depends only on the evidence
 * as of `now`, never on which trigger got here first. Serialized per agent by
 * an advisory lock, so concurrent evaluations append one gapless sequence
 * (unique(agentId, sequence) is the backstop) and a second evaluation of
 * unchanged evidence records nothing. Returns null when the agent isn't in
 * the organization.
 *
 * Informational in P3: nothing reads this to allow, block, or alter any
 * action.
 */
export async function evaluateTrust(
  organizationId: string,
  agentId: string,
  options: TrustEvaluationOptions
): Promise<TrustEvaluation | null> {
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trust:${agentId}`}))`;

    const evidence = await gatherTrustEvidence(tx, organizationId, agentId, now);
    if (!evidence) return null;

    const last = await tx.agentTrustTransition.findFirst({
      where: { agentId, organizationId },
      orderBy: { sequence: "desc" },
    });
    const existing = await tx.agentTrustState.findUnique({ where: { agentId } });

    const result = computeTrust(evidence, now, last?.newState ?? null);
    const next: TrustSnapshot = { state: result.state, score: result.score, factors: result.factors, limits: result.limits };

    let transition: AgentTrustTransition | null = null;
    let sequence = last?.sequence ?? 0;
    if (isMeaningfulChange(last ? { state: last.newState, score: last.newScore } : null, next)) {
      const previous: TrustSnapshot | null = last
        ? {
            state: last.newState,
            score: last.newScore,
            factors: last.factors as unknown as TrustFactor[],
            limits: last.limits as unknown as TrustLimit[],
          }
        : null;
      const description = describeTransition(previous, next);
      sequence += 1;
      transition = await tx.agentTrustTransition.create({
        data: {
          organizationId,
          agentId,
          sequence,
          occurredAt: now,
          previousState: last?.newState ?? null,
          newState: next.state,
          previousScore: last?.newScore ?? null,
          newScore: next.score,
          trigger: options.trigger,
          triggerRef: options.triggerRef ?? null,
          summary: description.summary,
          factors: next.factors as unknown as Prisma.InputJsonValue,
          limits: next.limits as unknown as Prisma.InputJsonValue,
          changes: description.changes as unknown as Prisma.InputJsonValue,
          methodologyVersion: TRUST_METHODOLOGY_VERSION,
        },
      });

      if (!last || last.newState !== next.state) {
        await recordAuditEvent(tx, {
          organizationId,
          actorType: "SYSTEM",
          agentId,
          eventType: AUDIT_EVENT_TYPES.AGENT_TRUST_CHANGED,
          entityType: "Agent",
          entityId: agentId,
          action: "agent.trust_changed",
          metadata: {
            previousState: last?.newState ?? null,
            newState: next.state,
            previousScore: last?.newScore ?? null,
            newScore: next.score,
            trigger: options.trigger,
            summary: description.summary,
          },
        });
      }
    }

    const stateChanged = !existing || existing.state !== next.state;
    const data = {
      state: next.state,
      score: next.score,
      stateSince: stateChanged ? now : existing!.stateSince,
      sequence,
      methodologyVersion: TRUST_METHODOLOGY_VERSION,
      factors: next.factors as unknown as Prisma.InputJsonValue,
      limits: next.limits as unknown as Prisma.InputJsonValue,
      categories: { totals: result.categories, omittedFactors: result.omittedFactors, evidenceScore: result.evidenceScore } as unknown as Prisma.InputJsonValue,
      evaluatedAt: now,
    };
    await tx.agentTrustState.upsert({
      where: { agentId },
      create: { agentId, organizationId, ...data },
      update: data,
    });

    return { state: next.state, score: next.score, recorded: transition !== null, transition };
  }, TX_OPTIONS);
}

/**
 * Schedules a re-evaluation after the response (lib/server/defer.ts): trust
 * is never part of the request that produced the evidence, and a failure
 * here must never fail it.
 */
export function scheduleTrustEvaluation(
  label: string,
  organizationId: string,
  agentId: string,
  options: Omit<TrustEvaluationOptions, "now">
): void {
  defer(`trust:${label}`, () => evaluateTrust(organizationId, agentId, options));
}
