/**
 * Integration test against the real dev database (DATABASE_URL from .env),
 * modeled on lib/approvals/__tests__/approvals.integration.test.ts — every
 * step in getOnboardingStatus is a real existence check against real rows,
 * so it needs real Postgres rather than mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getOnboardingStatus } from "@/lib/onboarding/status";

const RUN_ID = `test_${Date.now()}`;

let orgEmpty: { id: string };
let orgFull: { id: string };
let orgPartial: { id: string };
let user: { id: string };
let inviter: { id: string };

beforeAll(async () => {
  [orgEmpty, orgFull, orgPartial] = await Promise.all([
    prisma.organization.create({ data: { name: "Onboarding Empty", slug: `${RUN_ID}-empty` } }),
    prisma.organization.create({ data: { name: "Onboarding Full", slug: `${RUN_ID}-full` } }),
    prisma.organization.create({ data: { name: "Onboarding Partial", slug: `${RUN_ID}-partial` } }),
  ]);

  user = await prisma.user.create({ data: { email: `${RUN_ID}-member@example.com`, name: "Member" } });
  inviter = await prisma.user.create({ data: { email: `${RUN_ID}-inviter@example.com`, name: "Inviter" } });

  const agent = await prisma.agent.create({
    data: {
      organizationId: orgFull.id,
      name: "Full Org Agent",
      slug: "full-org-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  await prisma.activityEvent.create({
    data: { organizationId: orgFull.id, agentId: agent.id, eventType: "TOOL_CALL", action: "test.action" },
  });

  await prisma.policy.create({
    data: { organizationId: orgFull.id, name: "Test policy", action: "test.action", decision: "ALLOW" },
  });

  const evaluation = await prisma.policyEvaluation.create({
    data: {
      organizationId: orgFull.id,
      agentId: agent.id,
      action: "test.action",
      decision: "REQUIRE_APPROVAL",
      reason: "test",
    },
  });

  await prisma.approvalRequest.create({
    data: {
      organizationId: orgFull.id,
      agentId: agent.id,
      policyEvaluationId: evaluation.id,
      action: "test.action",
      reason: "test",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: orgFull.id, userId: user.id, role: "ENGINEER" },
      { organizationId: orgFull.id, userId: inviter.id, role: "OWNER" },
    ],
  });

  // Partial org: only an AgentPermission (not a Policy) and only a pending
  // invitation (not a second member) — confirms the OR-logic branches.
  const partialAgent = await prisma.agent.create({
    data: {
      organizationId: orgPartial.id,
      name: "Partial Org Agent",
      slug: "partial-org-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });
  await prisma.agentPermission.create({
    data: { organizationId: orgPartial.id, agentId: partialAgent.id, action: "test.action", decision: "ALLOW" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: orgPartial.id, userId: user.id, role: "OWNER" },
  });
  await prisma.organizationInvitation.create({
    data: {
      organizationId: orgPartial.id,
      email: `${RUN_ID}-invitee@example.com`,
      token: `${RUN_ID}-token`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
});

afterAll(async () => {
  const orgIds = [orgEmpty.id, orgFull.id, orgPartial.id];
  await prisma.approvalRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.policy.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agentPermission.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationInvitation.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [user.id, inviter.id] } } });
});

describe("getOnboardingStatus", () => {
  it("reports every step false for a brand-new organization", async () => {
    const status = await getOnboardingStatus(orgEmpty.id);
    expect(status).toEqual({
      agentConnected: false,
      firstEventReceived: false,
      firstPolicyCreated: false,
      firstEvaluationCompleted: false,
      approvalWorkflowUsed: false,
      teammateInvited: false,
      complete: false,
    });
  });

  it("reports every step true once every step's underlying row exists", async () => {
    const status = await getOnboardingStatus(orgFull.id);
    expect(status).toEqual({
      agentConnected: true,
      firstEventReceived: true,
      firstPolicyCreated: true,
      firstEvaluationCompleted: true,
      approvalWorkflowUsed: true,
      teammateInvited: true,
      complete: true,
    });
  });

  it("treats AgentPermission alone as a completed policy step, and a pending invitation alone as a completed invite step", async () => {
    const status = await getOnboardingStatus(orgPartial.id);
    expect(status.firstPolicyCreated).toBe(true);
    expect(status.teammateInvited).toBe(true);
    expect(status.complete).toBe(false);
  });
});
