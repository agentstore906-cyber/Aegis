/**
 * Integration test against the real dev database. Covers the kill-switch
 * service (lib/agents/control.ts) directly — the "use server" Action
 * (lib/agents/actions.ts#setAgentStatusAction) is a thin session/role
 * wrapper around it and holds no logic of its own to test here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { canManageAgents } from "@/lib/agents/authorization";
import {
  setAgentControlState,
  AgentNotFoundError,
  AgentArchivedError,
} from "@/lib/agents/control";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let user: { id: string };
let agent: { id: string; slug: string };
let archivedAgent: { id: string; slug: string };

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Kill Switch Org", slug: `${RUN_ID}-org` } });
  user = await prisma.user.create({ data: { email: `${RUN_ID}@example.com`, name: "Test Operator" } });
  agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      name: "Controlled Agent",
      slug: "controlled-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  archivedAgent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      name: "Archived Agent",
      slug: "archived-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
      status: "ARCHIVED",
    },
  });
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { organizationId: org.id } });
  await prisma.agent.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("setAgentControlState", () => {
  it("pauses an active agent and audits a truthful, unenforced outcome", async () => {
    const result = await setAgentControlState(org.id, agent.slug, "PAUSED", user.id, "quarterly review");

    expect(result.newStatus).toBe("PAUSED");
    expect(result.outcome.enforced).toBe(false);
    expect(result.outcome.mechanism).toBeNull();
    expect(result.outcome.detail).toMatch(/no enforcement connector/i);

    const updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.status).toBe("PAUSED");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: agent.id, eventType: "agent.paused" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorUserId).toBe(user.id);
    expect((auditEvent?.metadata as { enforced?: boolean } | null)?.enforced).toBe(false);
    expect((auditEvent?.metadata as { reason?: string } | null)?.reason).toBe("quarterly review");
  });

  it("stops a paused agent (kill switch) and audits agent.stopped", async () => {
    const result = await setAgentControlState(org.id, agent.slug, "STOPPED", user.id);
    expect(result.newStatus).toBe("STOPPED");
    expect(result.outcome.enforced).toBe(false);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: agent.id, eventType: "agent.stopped" },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("resumes a stopped agent back to ACTIVE and audits agent.resumed", async () => {
    const result = await setAgentControlState(org.id, agent.slug, "ACTIVE", user.id);
    expect(result.newStatus).toBe("ACTIVE");

    const updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.status).toBe("ACTIVE");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, entityId: agent.id, eventType: "agent.resumed" },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("refuses to control an archived agent", async () => {
    await expect(setAgentControlState(org.id, archivedAgent.slug, "STOPPED", user.id)).rejects.toThrow(
      AgentArchivedError
    );
  });

  it("refuses to control an agent that doesn't exist in this organization (also covers cross-org isolation)", async () => {
    await expect(setAgentControlState(org.id, "does-not-exist", "PAUSED", user.id)).rejects.toThrow(
      AgentNotFoundError
    );

    const otherOrg = await prisma.organization.create({
      data: { name: "Other Org", slug: `${RUN_ID}-other-org` },
    });
    try {
      // The real agent exists, but not in otherOrg — must not be reachable from there.
      await expect(setAgentControlState(otherOrg.id, agent.slug, "STOPPED", user.id)).rejects.toThrow(
        AgentNotFoundError
      );
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});

describe("kill switch authorization", () => {
  it("only roles with manage_agents can control an agent", () => {
    expect(canManageAgents("OWNER")).toBe(true);
    expect(canManageAgents("ADMIN")).toBe(true);
    expect(canManageAgents("SECURITY")).toBe(true);
    expect(canManageAgents("ENGINEER")).toBe(true);
    expect(canManageAgents("FINANCE")).toBe(false);
    expect(canManageAgents("VIEWER")).toBe(false);
  });
});
