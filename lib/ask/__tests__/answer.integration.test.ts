/**
 * Integration test against the real dev database. Ask Aegis has no LLM —
 * every intent is a real, organization-scoped query, so these assert the
 * routing is correct and the evidence actually traces back to real rows,
 * never a fabricated answer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Agent } from "@prisma/client";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/ask/answer";

const RUN_ID = `test_${Date.now()}`;

let org: { id: string };
let agent: Agent;

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: "Ask Org", slug: `${RUN_ID}-org` } });
  agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      name: "Ask Agent",
      slug: "ask-agent",
      owner: "Test",
      modelProvider: "Anthropic",
      modelName: "test-model",
    },
  });

  await prisma.policy.create({
    data: { organizationId: org.id, agentId: agent.id, name: "Block exports", decision: "BLOCK", action: "data.export" },
  });

  await prisma.policyEvaluation.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      action: "data.export",
      decision: "BLOCK",
      reason: "Blocked because the active policy matched.",
      traceId: `${RUN_ID}-block`,
    },
  });

  await prisma.activityEvent.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      eventType: "FINANCIAL",
      action: "refund.issue",
      status: "FAILED",
      riskLevel: "MEDIUM",
      source: "api",
    },
  });
});

afterAll(async () => {
  await prisma.policyEvaluation.deleteMany({ where: { organizationId: org.id } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: org.id } });
  await prisma.policy.deleteMany({ where: { organizationId: org.id } });
  await prisma.agent.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
});

describe("answerQuestion", () => {
  it("routes 'which actions were blocked' to real blocked-policy-evaluation evidence", async () => {
    const answer = await answerQuestion(org.id, "Which actions were blocked?");
    expect(answer.intent).toBe("blocked_actions");
    expect(answer.summary).toMatch(/blocked/i);
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.evidence[0]?.href).toMatch(/^\/policies\/evaluations\//);
  });

  it("routes a failure question to real FAILED activity evidence", async () => {
    const answer = await answerQuestion(org.id, "What happened before this failure?");
    expect(answer.intent).toBe("recent_failures");
    expect(answer.summary).toMatch(/refund\.issue/);
    expect(answer.evidence[0]?.href).toMatch(/^\/activity\//);
  });

  it("gives the honest fallback for an unmatched question, never a fabricated answer", async () => {
    const answer = await answerQuestion(org.id, "What is the meaning of life?");
    expect(answer.intent).toBe("none");
    expect(answer.summary).toBe("I don't have enough evidence to determine that.");
    expect(answer.evidence).toHaveLength(0);
  });

  it("gives the honest fallback for an empty question", async () => {
    const answer = await answerQuestion(org.id, "   ");
    expect(answer.intent).toBe("none");
  });
});

describe("organization isolation", () => {
  it("never answers using another organization's data", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Ask Org", slug: `${RUN_ID}-other` } });
    try {
      const answer = await answerQuestion(otherOrg.id, "Which actions were blocked?");
      expect(answer.summary).toMatch(/no actions have been blocked/i);
      expect(answer.evidence).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
