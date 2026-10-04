/** Shared integration fixtures for control-plane tests (not a test file). */
import type { Agent, PolicyDecision, Prisma, RiskControlMode, TrustState } from "@prisma/client";

import { prisma } from "@/lib/db";
import { buildProfile, type CategoricalRow } from "@/lib/behavior/profile";
import { startOfUtcDay } from "@/lib/behavior/rollup";

export const DAY = 86_400_000;
export const USUAL_HOST = "api.crm.example.com";
export const NEW_HOST = "files.unknown.example";
const today = startOfUtcDay(new Date());

let seq = 0;
export const nextSeq = () => (seq += 1);

export async function configureRisk(organizationId: string, mode: RiskControlMode, mediumAction: PolicyDecision = "ALERT", highAction: PolicyDecision = "REQUIRE_APPROVAL") {
  await prisma.organization.update({ where: { id: organizationId }, data: { riskControlMode: mode, riskMediumAction: mediumAction, riskHighAction: highAction } });
}

export async function makeAgent(
  organizationId: string,
  options: { slug?: string; baseline?: boolean; trust?: TrustState; owner?: string; environment?: "PRODUCTION" | "STAGING" | "DEVELOPMENT"; permissions?: { action: string; resource?: string; decision: PolicyDecision }[]; createdAt?: Date } = {}
): Promise<Agent> {
  const n = nextSeq();
  const agent = await prisma.agent.create({
    data: {
      organizationId,
      name: `cp-agent-${n}`,
      slug: options.slug ?? `cp-agent-${n}`,
      owner: options.owner ?? "Platform",
      environment: options.environment ?? "PRODUCTION",
      modelProvider: "Anthropic",
      modelName: "m",
      createdAt: options.createdAt ?? new Date(Date.now() - 40 * DAY),
    },
  });
  const permissions = options.permissions ?? [
    { action: "crm.read", decision: "ALLOW" as const },
    { action: "crm.export", decision: "ALLOW" as const },
    { action: "refund.issue", decision: "REQUIRE_APPROVAL" as const },
  ];
  if (permissions.length) {
    await prisma.agentPermission.createMany({
      data: permissions.map((p) => ({ organizationId, agentId: agent.id, action: p.action, resource: p.resource ?? "", decision: p.decision })),
    });
  }
  if (options.baseline) await giveBaseline(agent);
  if (options.trust) await giveTrust(agent, options.trust);
  return agent;
}

const row = (dimension: string, key: string, count: number): CategoricalRow => ({
  dimension,
  key,
  count,
  daysSeen: 15,
  firstSeen: new Date(today.getTime() - 20 * DAY),
  lastSeen: new Date(today.getTime() - DAY),
});

/** A HIGH-confidence ESTABLISHED baseline: one usual destination/tool/data class, ~10 records per event, active at every hour. */
export async function giveBaseline(agent: Agent) {
  const windowStart = new Date(today.getTime() - 28 * DAY);
  const hourlyTotals = [];
  for (let d = 1; d <= 15; d += 1) for (let h = 0; h < 24; h += 1) hourlyTotals.push({ hourStart: new Date(today.getTime() - d * DAY + h * 3_600_000), count: 1 });
  const built = buildProfile({
    windowStart,
    windowEnd: today,
    categorical: [row("destination", USUAL_HOST, 360), row("tool", "crm", 360), row("service", "crm-api", 360), row("eventType", "ACTION", 360), row("dataClass", "INTERNAL", 360)],
    hourlyTotals,
    excludedHours: new Set(),
    recordCounts: Array.from({ length: 30 }, () => 10),
    byteCounts: [],
  });
  await prisma.agentBaseline.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      version: 1,
      methodologyVersion: 1,
      maturity: "ESTABLISHED",
      windowStart,
      windowEnd: today,
      eventsObserved: built.eventsObserved,
      activeDays: built.activeDays,
      activeHours: built.activeHours,
      profile: built.profile as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function giveTrust(agent: Agent, state: TrustState) {
  await prisma.agentTrustState.create({
    data: {
      agentId: agent.id,
      organizationId: agent.organizationId,
      state,
      score: state === "TRUSTED" ? 95 : 52,
      stateSince: new Date(),
      sequence: 1,
      methodologyVersion: 1,
      factors: [],
      limits: [],
      categories: { totals: [], omittedFactors: 0, evidenceScore: 52 },
      evaluatedAt: new Date(),
    },
  });
}

export const CALM = { telemetry: { service: "crm-api", destination: { destination: USUAL_HOST, kind: "HOST" as const }, dataClasses: ["INTERNAL" as const], recordCount: 10 } };
/** New destination + PII + ~8x volume: independent families agree → HIGH. */
export const HIGH_REQ = { telemetry: { service: "crm-api", destination: { destination: NEW_HOST, kind: "HOST" as const }, dataClasses: ["PII" as const], recordCount: 80 } };
