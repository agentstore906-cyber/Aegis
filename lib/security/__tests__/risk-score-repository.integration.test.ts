/**
 * Integration test against the real dev database — getAgentRiskScore,
 * getHighRiskAgentsSummary, and listRecentAnomalies all assemble their
 * signals from real rows (SecurityAlert, ActivityEvent, PolicyEvaluation),
 * so their wiring is a query-layer guarantee tested here rather than
 * against mocks. Modeled on lib/security/__tests__/security.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  getAgentRiskScore,
  getHighRiskAgentsSummary,
  listRecentAnomalies,
  upsertAlertFinding,
} from "@/lib/security/repository";
import { SECURITY_ALERT_TYPES, type Finding } from "@/lib/security/types";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let cleanAgent: { id: string; riskLevel: "LOW" };
let riskyAgent: { id: string; riskLevel: "HIGH" };
let lowSeverityAgent: { id: string; riskLevel: "LOW" };

function finding(type: string, severity: Finding["severity"], agentId: string, overrides: Partial<Finding> = {}): Finding {
  return {
    type: type as Finding["type"],
    severity,
    agentId,
    title: `Test ${type}`,
    description: "Test description",
    evidence: {},
    ...overrides,
  };
}

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Risk Score Org A", slug: `${RUN_ID}-riskscore-a` } });
  orgB = await prisma.organization.create({ data: { name: "Risk Score Org B", slug: `${RUN_ID}-riskscore-b` } });

  cleanAgent = { id: (await prisma.agent.create({ data: agentData(orgA.id, "Clean Agent", "LOW") })).id, riskLevel: "LOW" };
  riskyAgent = { id: (await prisma.agent.create({ data: agentData(orgA.id, "Risky Agent", "HIGH") })).id, riskLevel: "HIGH" };
  lowSeverityAgent = {
    id: (await prisma.agent.create({ data: agentData(orgA.id, "Low Severity Agent", "LOW") })).id,
    riskLevel: "LOW",
  };

  const since = new Date();

  // riskyAgent: two open CRITICAL alerts, some blocked/failed/destructive activity, and a policy violation.
  await upsertAlertFinding(orgA.id, finding(SECURITY_ALERT_TYPES.HIGH_RISK_BURST, "CRITICAL", riskyAgent.id));
  await upsertAlertFinding(orgA.id, finding(SECURITY_ALERT_TYPES.COST_SPIKE, "CRITICAL", riskyAgent.id, { title: "Second critical" }));
  await prisma.activityEvent.createMany({
    data: [
      { organizationId: orgA.id, agentId: riskyAgent.id, eventType: "ACTION", action: "record.delete", status: "ALLOWED", timestamp: since },
      { organizationId: orgA.id, agentId: riskyAgent.id, eventType: "ACTION", action: "task.run", status: "BLOCKED", timestamp: since },
      { organizationId: orgA.id, agentId: riskyAgent.id, eventType: "ACTION", action: "task.run", status: "FAILED", timestamp: since },
    ],
  });
  await prisma.policyEvaluation.create({
    data: {
      organizationId: orgA.id,
      agentId: riskyAgent.id,
      action: "refund.issue",
      decision: "BLOCK",
      reason: "Test denial",
    },
  });

  // lowSeverityAgent: one LOW-severity alert only — should not appear in the high-risk-agents ranking.
  await upsertAlertFinding(orgA.id, finding(SECURITY_ALERT_TYPES.NEW_TOOL_USAGE, "LOW", lowSeverityAgent.id));
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.securityAlert.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

function agentData(organizationId: string, name: string, riskLevel: "LOW" | "HIGH") {
  return {
    organizationId,
    name: `${name} ${RUN_ID}`,
    slug: `${name.toLowerCase().replace(/ /g, "-")}-${RUN_ID}`,
    owner: "Test",
    modelProvider: "Anthropic",
    modelName: "test-model",
    riskLevel,
  };
}

describe("getAgentRiskScore", () => {
  it("scores 0 with no factors for a clean LOW-risk agent", async () => {
    const result = await getAgentRiskScore(orgA.id, { id: cleanAgent.id, riskLevel: "LOW" });
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  it("combines open critical alerts, agent classification, blocked/failed/destructive activity, and policy violations into a high score with reasons", async () => {
    const result = await getAgentRiskScore(orgA.id, { id: riskyAgent.id, riskLevel: "HIGH" });
    expect(result.score).toBeGreaterThan(50);
    expect(result.factors.length).toBeGreaterThan(3);
    expect(result.factors.some((f) => f.label.includes("critical"))).toBe(true);
  });

  it("never lets another organization's agent risk score include this organization's alerts or activity", async () => {
    // riskyAgent belongs to orgA — scoring it "as if" under orgB must see none of orgA's data.
    const result = await getAgentRiskScore(orgB.id, { id: riskyAgent.id, riskLevel: "HIGH" });
    expect(result.score).toBe(20); // only the agentRiskLevel: HIGH factor survives — none of orgA's alerts/activity leak in
    expect(result.factors).toHaveLength(1);
  });
});

describe("getHighRiskAgentsSummary", () => {
  it("includes only agents with an open HIGH/CRITICAL alert, ranked by critical count first", async () => {
    const summary = await getHighRiskAgentsSummary(orgA.id, 10);
    const agentIds = summary.map((row) => row.agent.id);

    expect(agentIds).toContain(riskyAgent.id);
    expect(agentIds).not.toContain(cleanAgent.id);
    expect(agentIds).not.toContain(lowSeverityAgent.id); // LOW-severity-only agent excluded

    const riskyRow = summary.find((row) => row.agent.id === riskyAgent.id)!;
    expect(riskyRow.criticalAlertCount).toBe(2);
  });

  it("never includes another organization's agents", async () => {
    const summary = await getHighRiskAgentsSummary(orgB.id, 10);
    expect(summary).toHaveLength(0);
  });
});

describe("listRecentAnomalies", () => {
  it("includes anomaly-type alerts (e.g. HIGH_RISK_BURST) but not a plain NEW_TOOL_USAGE alert", async () => {
    const anomalies = await listRecentAnomalies(orgA.id, 10);
    const types = anomalies.map((a) => a.type);

    expect(types).toContain(SECURITY_ALERT_TYPES.HIGH_RISK_BURST);
    expect(types).not.toContain(SECURITY_ALERT_TYPES.NEW_TOOL_USAGE);
  });

  it("never includes another organization's anomalies", async () => {
    const anomalies = await listRecentAnomalies(orgB.id, 10);
    expect(anomalies).toHaveLength(0);
  });
});
