import "server-only";

import type { AgentTrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { TRUST_MAX_STALENESS_MS } from "@/lib/trust/config";
import { evaluateTrust } from "@/lib/trust/evaluate";
import { headline } from "@/lib/trust/score";
import type { TrustCategoryTotal, TrustFactor, TrustLimit, TrustSnapshot } from "@/lib/trust/types";

/**
 * Read side of agent trust. Every function takes the caller's
 * organizationId (from the session or the API key — never from input) and
 * returns null for an agent outside that organization, so no query can
 * surface another tenant's trust.
 */

export type TrustView = {
  state: AgentTrustState["state"];
  score: number;
  stateSince: Date;
  evaluatedAt: Date;
  methodologyVersion: number;
  /** One sentence: why the agent is in this state. */
  headline: string;
  factors: TrustFactor[];
  limits: TrustLimit[];
  categories: TrustCategoryTotal[];
  omittedFactors: number;
  /** Score from evidence alone, before limits such as insufficient history. */
  evidenceScore: number;
};

type StoredCategories = { totals: TrustCategoryTotal[]; omittedFactors: number; evidenceScore: number };

export function toTrustView(row: AgentTrustState): TrustView {
  const categories = row.categories as unknown as StoredCategories;
  const factors = row.factors as unknown as TrustFactor[];
  const limits = row.limits as unknown as TrustLimit[];
  const snapshot: TrustSnapshot = { state: row.state, score: row.score, factors, limits };
  return {
    state: row.state,
    score: row.score,
    stateSince: row.stateSince,
    evaluatedAt: row.evaluatedAt,
    methodologyVersion: row.methodologyVersion,
    headline: headline(snapshot),
    factors,
    limits,
    categories: categories.totals,
    omittedFactors: categories.omittedFactors,
    evidenceScore: categories.evidenceScore,
  };
}

/**
 * The agent's current trust. Evaluates first when it has never been
 * evaluated or the stored evaluation is stale, so time-based decay (recovery)
 * shows up without needing new activity.
 */
export async function getTrust(organizationId: string, agentId: string, now = new Date()): Promise<TrustView | null> {
  const stored = await prisma.agentTrustState.findFirst({ where: { agentId, organizationId } });
  if (stored && now.getTime() - stored.evaluatedAt.getTime() <= TRUST_MAX_STALENESS_MS) return toTrustView(stored);

  const evaluated = await evaluateTrust(organizationId, agentId, { trigger: "ON_DEMAND", now });
  if (!evaluated) return null;
  const fresh = await prisma.agentTrustState.findFirst({ where: { agentId, organizationId } });
  return fresh ? toTrustView(fresh) : null;
}

export type TrustHistoryOptions = {
  limit?: number;
  /** Return transitions with a sequence lower than this (cursor pagination, newest first). */
  before?: number;
};

/** Trust transitions, newest first. Rows are immutable history exactly as recorded. */
export async function listTrustHistory(organizationId: string, agentId: string, options: TrustHistoryOptions = {}) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, organizationId }, select: { id: true } });
  if (!agent) return null;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const rows = await prisma.agentTrustTransition.findMany({
    where: { organizationId, agentId, ...(options.before ? { sequence: { lt: options.before } } : {}) },
    orderBy: { sequence: "desc" },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return { transitions: page, nextBefore: rows.length > limit ? page[page.length - 1].sequence : null };
}
