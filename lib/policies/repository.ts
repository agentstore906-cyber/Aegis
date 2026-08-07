import "server-only";

import { Prisma } from "@prisma/client";
import type {
  ConditionOperator,
  Environment,
  PolicyDecision,
  PolicyStatus,
  RiskLevel,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import type { PolicyWithConditions } from "@/lib/policies/matcher";

export class DuplicatePermissionError extends Error {
  constructor() {
    super("A permission already exists for this exact agent, action, and resource.");
    this.name = "DuplicatePermissionError";
  }
}

// ---------------------------------------------------------------------------
// Agent permissions
// ---------------------------------------------------------------------------

export type AgentPermissionInput = {
  action: string;
  resource: string; // "" = any resource
  decision: PolicyDecision;
  description?: string | null;
};

export async function listAgentPermissions(organizationId: string, agentId: string) {
  return prisma.agentPermission.findMany({
    where: { organizationId, agentId },
    orderBy: [{ action: "asc" }, { resource: "asc" }],
  });
}

export async function getAgentPermission(organizationId: string, id: string) {
  return prisma.agentPermission.findFirst({ where: { id, organizationId } });
}

export async function createAgentPermission(
  organizationId: string,
  agentId: string,
  input: AgentPermissionInput
) {
  try {
    return await prisma.agentPermission.create({
      data: { organizationId, agentId, ...input },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicatePermissionError();
    }
    throw error;
  }
}

export async function updateAgentPermission(
  organizationId: string,
  id: string,
  input: AgentPermissionInput
) {
  try {
    const result = await prisma.agentPermission.updateMany({
      where: { id, organizationId },
      data: input,
    });
    if (result.count === 0) return null;
    return prisma.agentPermission.findFirst({ where: { id, organizationId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicatePermissionError();
    }
    throw error;
  }
}

export async function deleteAgentPermission(organizationId: string, id: string) {
  const result = await prisma.agentPermission.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

export async function getAgentPermissionSummary(organizationId: string, agentId: string) {
  const grouped = await prisma.agentPermission.groupBy({
    by: ["decision"],
    where: { organizationId, agentId },
    _count: true,
  });

  const summary = { ALLOW: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 };
  for (const row of grouped) summary[row.decision] = row._count;
  return summary;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type PolicyConditionInput = {
  field: string;
  operator: ConditionOperator;
  value: Prisma.InputJsonValue;
};

export type PolicyInput = {
  name: string;
  description?: string | null;
  status: PolicyStatus;
  priority: number;
  decision: PolicyDecision;
  agentId?: string | null;
  action: string;
  resource?: string | null;
  environment?: Environment | null;
  tool?: string | null;
  riskLevel?: RiskLevel | null;
  conditions: PolicyConditionInput[];
};

export type PolicyFilters = {
  q?: string;
  status?: PolicyStatus;
  decision?: PolicyDecision;
  page: number;
};

const POLICY_PAGE_SIZE = 20;

export async function listPolicies(organizationId: string, filters: PolicyFilters) {
  const where: Prisma.PolicyWhereInput = {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.decision ? { decision: filters.decision } : {}),
    ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
  };

  const [policies, total] = await Promise.all([
    prisma.policy.findMany({
      where,
      include: { agent: { select: { id: true, name: true, slug: true } }, conditions: true },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      skip: (filters.page - 1) * POLICY_PAGE_SIZE,
      take: POLICY_PAGE_SIZE,
    }),
    prisma.policy.count({ where }),
  ]);

  return {
    policies,
    total,
    pageCount: Math.max(1, Math.ceil(total / POLICY_PAGE_SIZE)),
    pageSize: POLICY_PAGE_SIZE,
  };
}

export async function getPolicy(organizationId: string, id: string) {
  return prisma.policy.findFirst({
    where: { id, organizationId },
    include: { conditions: true, agent: { select: { id: true, name: true, slug: true } } },
  });
}

export async function listPoliciesForAgent(organizationId: string, agentId: string) {
  return prisma.policy.findMany({
    where: { organizationId, OR: [{ agentId }, { agentId: null }] },
    include: { conditions: true },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
}

export async function createPolicy(
  organizationId: string,
  createdById: string | null,
  input: PolicyInput
) {
  const { conditions, ...policyFields } = input;
  return prisma.policy.create({
    data: {
      organizationId,
      createdById,
      ...policyFields,
      conditions: { create: conditions },
    },
    include: { conditions: true },
  });
}

export async function updatePolicy(organizationId: string, id: string, input: PolicyInput) {
  const { conditions, ...policyFields } = input;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.policy.findFirst({ where: { id, organizationId } });
    if (!existing) return null;

    await tx.policyCondition.deleteMany({ where: { policyId: id } });

    return tx.policy.update({
      where: { id },
      data: { ...policyFields, conditions: { create: conditions } },
      include: { conditions: true },
    });
  });
}

export async function setPolicyStatus(organizationId: string, id: string, status: PolicyStatus) {
  const result = await prisma.policy.updateMany({ where: { id, organizationId }, data: { status } });
  return result.count > 0;
}

export async function deletePolicy(organizationId: string, id: string) {
  const result = await prisma.policy.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

/** Active policies scoped to an agent (agent-specific + org-wide), pre-filtered at the query level. */
export async function listActivePoliciesForEvaluation(
  organizationId: string,
  agentId: string
): Promise<PolicyWithConditions[]> {
  return prisma.policy.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      OR: [{ agentId }, { agentId: null }],
    },
    include: { conditions: true },
  });
}

// ---------------------------------------------------------------------------
// Policy evaluations
// ---------------------------------------------------------------------------

export type PolicyEvaluationFilters = {
  agentId?: string;
  decision?: PolicyDecision;
  page: number;
};

const EVALUATION_PAGE_SIZE = 25;

export async function listPolicyEvaluations(organizationId: string, filters: PolicyEvaluationFilters) {
  const where: Prisma.PolicyEvaluationWhereInput = {
    organizationId,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.decision ? { decision: filters.decision } : {}),
  };

  const [evaluations, total] = await Promise.all([
    prisma.policyEvaluation.findMany({
      where,
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * EVALUATION_PAGE_SIZE,
      take: EVALUATION_PAGE_SIZE,
    }),
    prisma.policyEvaluation.count({ where }),
  ]);

  return {
    evaluations,
    total,
    pageCount: Math.max(1, Math.ceil(total / EVALUATION_PAGE_SIZE)),
    pageSize: EVALUATION_PAGE_SIZE,
  };
}

export async function getPolicyEvaluation(organizationId: string, id: string) {
  return prisma.policyEvaluation.findFirst({
    where: { id, organizationId },
    include: { agent: { select: { id: true, name: true, slug: true } }, activityEvent: true },
  });
}

export async function getPolicyDashboardStats(organizationId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const grouped = await prisma.policyEvaluation.groupBy({
    by: ["decision"],
    where: { organizationId, createdAt: { gte: since } },
    _count: true,
  });

  const stats = { ALLOW: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 };
  for (const row of grouped) stats[row.decision] = row._count;

  const recentBlocked = await prisma.policyEvaluation.findMany({
    where: { organizationId, decision: "BLOCK" },
    include: { agent: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return { last24h: stats, recentBlocked };
}
