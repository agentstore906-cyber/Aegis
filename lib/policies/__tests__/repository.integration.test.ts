/**
 * Integration test against the real dev database (DATABASE_URL from .env).
 * Organization isolation is fundamentally a query-layer guarantee, so it's
 * tested here rather than against the pure matcher/resolver functions.
 * Creates its own throwaway orgs/agents/policies and cleans them up in a
 * finally block regardless of outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listActivePoliciesForEvaluation, listAgentPermissions } from "@/lib/policies/repository";
import { evaluateAgentAction } from "@/lib/policies/evaluate";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let agentA: { id: string };
let agentB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Org A", slug: `${RUN_ID}-org-a` } });
  orgB = await prisma.organization.create({ data: { name: "Org B", slug: `${RUN_ID}-org-b` } });

  agentA = await prisma.agent.create({
    data: {
      organizationId: orgA.id,
      name: "Agent A",
      slug: "agent-a",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  agentB = await prisma.agent.create({
    data: {
      organizationId: orgB.id,
      name: "Agent B",
      slug: "agent-b",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  await prisma.agentPermission.create({
    data: { organizationId: orgA.id, agentId: agentA.id, action: "invoice.read", resource: "", decision: "ALLOW" },
  });
  await prisma.policy.create({
    data: {
      organizationId: orgA.id,
      name: "Org A block policy",
      decision: "BLOCK",
      action: "customer.delete",
    },
  });
});

afterAll(async () => {
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await prisma.$disconnect();
});

describe("organization isolation", () => {
  it("never returns another organization's policies", async () => {
    const policiesForOrgB = await listActivePoliciesForEvaluation(orgB.id, agentB.id);
    expect(policiesForOrgB).toHaveLength(0);

    const policiesForOrgA = await listActivePoliciesForEvaluation(orgA.id, agentA.id);
    expect(policiesForOrgA.map((p) => p.name)).toContain("Org A block policy");
  });

  it("never returns another organization's agent permissions", async () => {
    const permissionsForB = await listAgentPermissions(orgB.id, agentA.id);
    expect(permissionsForB).toHaveLength(0);
  });

  it("evaluateAgentAction refuses to evaluate an agent against the wrong organization", async () => {
    await expect(
      evaluateAgentAction({ organizationId: orgB.id, agentId: agentA.id, action: "invoice.read" })
    ).rejects.toThrow(/not found/i);
  });

  it("evaluateAgentAction resolves correctly within the right organization", async () => {
    const result = await evaluateAgentAction({
      organizationId: orgA.id,
      agentId: agentA.id,
      action: "invoice.read",
    });
    expect(result.decision).toBe("ALLOW");
  });
});
