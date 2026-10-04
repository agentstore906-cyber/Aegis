import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * How strongly is an agent's identity protected against impersonation?
 *
 * The agent an API request names is only a claim; what makes it an
 * authorized identity is the API key (P0 §7). A key bound to one agent can
 * act only as that agent. An ORGANIZATION-WIDE key can act as ANY agent in
 * the organization — a deliberate choice at creation time, but one that means
 * every holder of such a key can speak for every agent. Nothing showed which
 * agents are exposed that way; this does, from stored keys only.
 *
 *   ISOLATED        has a dedicated bound key, and the organization has no active org-wide key
 *   BOUND_SHARED    has a dedicated bound key, but active org-wide keys also exist — their
 *                   holders can still act as this agent
 *   ORG_WIDE_ONLY   no dedicated key: the agent's identity is only protected by shared keys
 *   NO_KEY          no active key at all (e.g. a connector-managed agent that cannot call the API)
 */
export type IdentityAssurance = "ISOLATED" | "BOUND_SHARED" | "ORG_WIDE_ONLY" | "NO_KEY";

export type IdentityBinding = {
  assurance: IdentityAssurance;
  boundKeys: number;
  /** Active organization-wide keys in this organization (the same number for every agent). */
  orgWideKeys: number;
};

export function assuranceFor(boundKeys: number, orgWideKeys: number): IdentityAssurance {
  if (boundKeys > 0) return orgWideKeys > 0 ? "BOUND_SHARED" : "ISOLATED";
  return orgWideKeys > 0 ? "ORG_WIDE_ONLY" : "NO_KEY";
}

/** Tenant-scoped; two queries for any number of agents. Revoked and expired keys do not count. */
export async function getIdentityBindings(organizationId: string, agentIds: string[], now = new Date()): Promise<Map<string, IdentityBinding>> {
  const active = { organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } satisfies Prisma.ApiKeyWhereInput;
  const [orgWideKeys, bound] = await Promise.all([
    prisma.apiKey.count({ where: { ...active, agentId: null } }),
    agentIds.length
      ? prisma.apiKey.groupBy({ by: ["agentId"], where: { ...active, agentId: { in: agentIds } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const counts = new Map(bound.flatMap((b) => (b.agentId ? [[b.agentId, b._count._all] as const] : [])));
  return new Map(agentIds.map((id) => [id, { assurance: assuranceFor(counts.get(id) ?? 0, orgWideKeys), boundKeys: counts.get(id) ?? 0, orgWideKeys }]));
}
