import "server-only";

import type { AgentStatus, Environment, PolicyDecision, TrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnforcementCoverage, type EnforcementCoverage } from "@/lib/control/coverage";
import { getIdentityBindings, type IdentityBinding } from "@/lib/control/identity";
import {
  adoptionStage,
  attentionFlags,
  derivePosture,
  isUnowned,
  type AdoptionStage,
  type AgentPosture,
  type AttentionFlag,
} from "@/lib/control/posture";

/**
 * The organization-wide control view: for every agent, who it is, what it may
 * do, what it is doing, whether it is behaving unusually, how trusted and
 * risky it is, what needs a human, what incidents it has, and whether Aegis is
 * actually in its loop. Every number is a count of stored rows.
 *
 * Cost model: a FIXED number of grouped, tenant-scoped queries for the whole
 * organization (never one query per agent), bounded by MAX_INVENTORY_AGENTS and
 * a window. Beyond that bound the view says so (`truncated`) — the next step at
 * that scale is a materialized per-agent summary (architecture doc §12).
 */

export const MAX_INVENTORY_AGENTS = 2_000;
export const INVENTORY_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type InventoryAgent = {
  id: string;
  slug: string;
  name: string;
  owner: string;
  team: string | null;
  environment: Environment;
  status: AgentStatus;
  framework: string | null;
  model: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  connection: string | null;
  posture: AgentPosture;
  adoption: AdoptionStage;
  attention: AttentionFlag[];
  access: { allow: number; alert: number; requireApproval: number; block: number; total: number; broadGrants: number };
  trust: { state: TrustState; score: number } | null;
  baselineMaturity: string | null;
  deviations7d: number;
  openIncidents: number;
  pendingApprovals: number;
  decisions7d: Record<PolicyDecision, number>;
  activityEvents7d: number;
  coverage: EnforcementCoverage;
  identity: IdentityBinding;
};

export type InventorySummary = {
  total: number;
  windowDays: number;
  byStatus: Record<string, number>;
  byEnvironment: Record<string, number>;
  byPosture: Record<string, number>;
  byAdoption: Record<string, number>;
  owners: number;
  unowned: number;
  /** ACTIVE agents with no permission granted: Aegis default-denies everything they ask. */
  nothingGranted: number;
  unusualBehavior: number;
  stoppedOrPaused: number;
  needingApproval: number;
  withOpenIncidents: number;
  sharedKeyIdentity: number;
  /** Agents that report activity but never request a decision. */
  observeOnly: number;
  ranDespiteDecision: number;
};

export type InventoryFilters = {
  environment?: Environment;
  status?: AgentStatus;
  posture?: AgentPosture;
  flag?: AttentionFlag;
  /** Case-insensitive substring of name, slug or owner. */
  q?: string;
  page?: number;
  pageSize?: number;
};

export type Inventory = {
  summary: InventorySummary;
  agents: InventoryAgent[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** More than MAX_INVENTORY_AGENTS agents exist; the oldest were not examined. */
  truncated: boolean;
};

const ZERO_DECISIONS = (): Record<PolicyDecision, number> => ({ ALLOW: 0, ALERT: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 });

/** Builds inventory rows for the given agent rows. Every query is organization-scoped and grouped. */
async function buildRows(
  organizationId: string,
  agents: {
    id: string;
    slug: string;
    name: string;
    owner: string;
    environment: Environment;
    status: AgentStatus;
    framework: string | null;
    modelName: string;
    createdAt: Date;
    lastActiveAt: Date | null;
    team: { name: string } | null;
    connection: { status: string } | null;
    trustState: { state: TrustState; score: number } | null;
  }[],
  now: Date
): Promise<InventoryAgent[]> {
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) return [];
  const since = new Date(now.getTime() - INVENTORY_WINDOW_DAYS * DAY_MS);
  const inIds = { in: ids };

  const [permissions, broad, deviations, incidents, approvals, decisions, activity, baselines, coverage, identity] = await Promise.all([
    prisma.agentPermission.groupBy({ by: ["agentId", "decision"], where: { organizationId, agentId: inIds }, _count: { _all: true } }),
    prisma.agentPermission.groupBy({
      by: ["agentId"],
      where: { organizationId, agentId: inIds, decision: "ALLOW", resource: "", action: { endsWith: ".*" } },
      _count: { _all: true },
    }),
    prisma.behavioralDeviation.groupBy({ by: ["agentId"], where: { organizationId, agentId: inIds, lastSeenAt: { gte: since } }, _count: { _all: true } }),
    prisma.incident.groupBy({ by: ["agentId"], where: { organizationId, agentId: inIds, status: { in: ["OPEN", "INVESTIGATING"] } }, _count: { _all: true } }),
    prisma.approvalRequest.groupBy({ by: ["agentId"], where: { organizationId, agentId: inIds, status: "PENDING" }, _count: { _all: true } }),
    prisma.policyEvaluation.groupBy({ by: ["agentId", "decision"], where: { organizationId, agentId: inIds, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.activityEvent.groupBy({ by: ["agentId"], where: { organizationId, agentId: inIds, timestamp: { gte: since } }, _count: { _all: true } }),
    prisma.$queryRaw<{ agent_id: string; maturity: string }[]>`
      SELECT DISTINCT ON ("agentId") "agentId" AS agent_id, "maturity"::text AS maturity
        FROM "agent_baselines"
       WHERE "organizationId" = ${organizationId} AND "agentId" = ANY(${ids}::text[])
       ORDER BY "agentId", "version" DESC`,
    getEnforcementCoverage(organizationId, ids, { days: INVENTORY_WINDOW_DAYS, now }),
    getIdentityBindings(organizationId, ids, now),
  ]);

  const count = <T extends { agentId: string; _count: { _all: number } }>(rows: T[]) => new Map(rows.map((r) => [r.agentId, r._count._all]));
  const broadBy = count(broad);
  const deviationsBy = count(deviations);
  const incidentsBy = count(incidents);
  const approvalsBy = count(approvals);
  const activityBy = count(activity);
  const maturityBy = new Map(baselines.map((b) => [b.agent_id, b.maturity]));

  return agents.map((a) => {
    const access = { allow: 0, alert: 0, requireApproval: 0, block: 0, total: 0, broadGrants: broadBy.get(a.id) ?? 0 };
    for (const p of permissions) {
      if (p.agentId !== a.id) continue;
      const n = p._count._all;
      access.total += n;
      if (p.decision === "ALLOW") access.allow += n;
      else if (p.decision === "ALERT") access.alert += n;
      else if (p.decision === "REQUIRE_APPROVAL") access.requireApproval += n;
      else access.block += n;
    }
    const decided = ZERO_DECISIONS();
    for (const d of decisions) if (d.agentId === a.id) decided[d.decision] += d._count._all;
    const cov = coverage.get(a.id)!;
    const identityBinding = identity.get(a.id)!;
    const activityEvents7d = activityBy.get(a.id) ?? 0;
    const decisionRequests = Object.values(decided).reduce((s, n) => s + n, 0);
    const posture = derivePosture({ status: a.status, permissionCount: access.total, activityEvents: activityEvents7d, decisionRequests });

    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      owner: a.owner,
      team: a.team?.name ?? null,
      environment: a.environment,
      status: a.status,
      framework: a.framework,
      model: a.modelName,
      createdAt: a.createdAt,
      lastActiveAt: a.lastActiveAt,
      connection: a.connection?.status ?? null,
      posture,
      adoption: adoptionStage({ activityEvents: activityEvents7d, decisionRequests }),
      attention: attentionFlags({
        trustState: a.trustState?.state ?? null,
        deviations7d: deviationsBy.get(a.id) ?? 0,
        openIncidents: incidentsBy.get(a.id) ?? 0,
        pendingApprovals: approvalsBy.get(a.id) ?? 0,
        broadGrants: access.broadGrants,
        identityAssurance: identityBinding.assurance,
        activityEvents: activityEvents7d,
        ranDespite: cov.ranDespite,
        owner: a.owner,
      }),
      access,
      trust: a.trustState ? { state: a.trustState.state, score: a.trustState.score } : null,
      baselineMaturity: maturityBy.get(a.id) ?? null,
      deviations7d: deviationsBy.get(a.id) ?? 0,
      openIncidents: incidentsBy.get(a.id) ?? 0,
      pendingApprovals: approvalsBy.get(a.id) ?? 0,
      decisions7d: decided,
      activityEvents7d,
      coverage: cov,
      identity: identityBinding,
    };
  });
}

const AGENT_SELECT = {
  id: true,
  slug: true,
  name: true,
  owner: true,
  environment: true,
  status: true,
  framework: true,
  modelName: true,
  createdAt: true,
  lastActiveAt: true,
  team: { select: { name: true } },
  connection: { select: { status: true } },
  trustState: { select: { state: true, score: true } },
} as const;

export function summarize(rows: InventoryAgent[]): InventorySummary {
  const tally = (pick: (a: InventoryAgent) => string) => {
    const out: Record<string, number> = {};
    for (const a of rows) out[pick(a)] = (out[pick(a)] ?? 0) + 1;
    return out;
  };
  const has = (a: InventoryAgent, f: AttentionFlag) => a.attention.includes(f);
  return {
    total: rows.length,
    windowDays: INVENTORY_WINDOW_DAYS,
    byStatus: tally((a) => a.status),
    byEnvironment: tally((a) => a.environment),
    byPosture: tally((a) => a.posture),
    byAdoption: tally((a) => a.adoption),
    owners: new Set(rows.filter((a) => !isUnowned(a.owner)).map((a) => a.owner.trim().toLowerCase())).size,
    unowned: rows.filter((a) => has(a, "NO_OWNER")).length,
    nothingGranted: rows.filter((a) => a.posture === "DISCOVERED").length,
    unusualBehavior: rows.filter((a) => has(a, "UNUSUAL_BEHAVIOR")).length,
    stoppedOrPaused: rows.filter((a) => a.status === "STOPPED" || a.status === "PAUSED").length,
    needingApproval: rows.filter((a) => has(a, "PENDING_APPROVAL")).length,
    withOpenIncidents: rows.filter((a) => has(a, "OPEN_INCIDENT")).length,
    sharedKeyIdentity: rows.filter((a) => has(a, "SHARED_IDENTITY")).length,
    observeOnly: rows.filter((a) => a.posture === "OBSERVED").length,
    ranDespiteDecision: rows.filter((a) => has(a, "RAN_DESPITE_DECISION")).length,
  };
}

export async function getInventory(organizationId: string, filters: InventoryFilters = {}, now = new Date()): Promise<Inventory> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);

  const agents = await prisma.agent.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_INVENTORY_AGENTS + 1,
    select: AGENT_SELECT,
  });
  const truncated = agents.length > MAX_INVENTORY_AGENTS;
  const rows = await buildRows(organizationId, agents.slice(0, MAX_INVENTORY_AGENTS), now);

  const q = filters.q?.trim().toLowerCase();
  const filtered = rows.filter(
    (a) =>
      (!filters.environment || a.environment === filters.environment) &&
      (!filters.status || a.status === filters.status) &&
      (!filters.posture || a.posture === filters.posture) &&
      (!filters.flag || a.attention.includes(filters.flag)) &&
      (!q || a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q) || a.owner.toLowerCase().includes(q))
  );
  // Needs-attention first (most flags), then by name — deterministic.
  filtered.sort((a, b) => b.attention.length - a.attention.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));

  return {
    summary: summarize(rows),
    agents: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(filtered.length / pageSize), 1),
    truncated,
  };
}

/** One agent's inventory row (organization-scoped; null if it is not in this organization). */
export async function getInventoryAgent(organizationId: string, slug: string, now = new Date()): Promise<InventoryAgent | null> {
  const agent = await prisma.agent.findFirst({ where: { organizationId, slug }, select: AGENT_SELECT });
  if (!agent) return null;
  return (await buildRows(organizationId, [agent], now))[0] ?? null;
}
