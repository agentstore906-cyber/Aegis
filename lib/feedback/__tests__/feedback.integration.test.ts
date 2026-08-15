/**
 * Integration test against the real dev database — vote toggling and
 * tenant isolation for the feature-request model, modeled on
 * lib/approvals/__tests__/approvals.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createFeatureRequest, listFeatureRequests, toggleVote } from "@/lib/feedback/repository";

const RUN_ID = `test_${Date.now()}`;

let orgA: { id: string };
let orgB: { id: string };
let userA: { id: string };
let userB: { id: string };

beforeAll(async () => {
  orgA = await prisma.organization.create({ data: { name: "Feedback Org A", slug: `${RUN_ID}-fb-a` } });
  orgB = await prisma.organization.create({ data: { name: "Feedback Org B", slug: `${RUN_ID}-fb-b` } });
  userA = await prisma.user.create({ data: { email: `${RUN_ID}-a@example.com`, name: "User A" } });
  userB = await prisma.user.create({ data: { email: `${RUN_ID}-b@example.com`, name: "User B" } });
});

afterAll(async () => {
  const orgIds = [orgA.id, orgB.id];
  await prisma.featureRequestVote.deleteMany({ where: { featureRequest: { organizationId: { in: orgIds } } } });
  await prisma.featureRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
});

describe("toggleVote", () => {
  it("creates a vote, then removes it on a second toggle", async () => {
    const request = await createFeatureRequest(orgA.id, userA.id, { title: "Toggle test" });

    const first = await toggleVote(orgA.id, request.id, userA.id);
    expect(first).toEqual({ voted: true });

    const [afterVote] = await listFeatureRequests(orgA.id, userA.id);
    expect(afterVote.voteCount).toBe(1);
    expect(afterVote.hasVoted).toBe(true);

    const second = await toggleVote(orgA.id, request.id, userA.id);
    expect(second).toEqual({ voted: false });

    const [afterUnvote] = await listFeatureRequests(orgA.id, userA.id);
    expect(afterUnvote.voteCount).toBe(0);
    expect(afterUnvote.hasVoted).toBe(false);
  });

  it("does not let a second user's vote count toward the first user's hasVoted flag", async () => {
    const request = await createFeatureRequest(orgA.id, userA.id, { title: "Multi-voter test" });
    await toggleVote(orgA.id, request.id, userB.id);

    const asUserA = await listFeatureRequests(orgA.id, userA.id);
    const row = asUserA.find((r) => r.id === request.id)!;
    expect(row.voteCount).toBe(1);
    expect(row.hasVoted).toBe(false);
  });

  it("refuses to vote on a request belonging to a different organization", async () => {
    const request = await createFeatureRequest(orgA.id, userA.id, { title: "Cross-org vote attempt" });
    const result = await toggleVote(orgB.id, request.id, userB.id);
    expect(result).toBeNull();

    const voteCount = await prisma.featureRequestVote.count({ where: { featureRequestId: request.id } });
    expect(voteCount).toBe(0);
  });
});

describe("listFeatureRequests tenant isolation", () => {
  it("never returns another organization's requests", async () => {
    await createFeatureRequest(orgB.id, userB.id, { title: "Org B only" });
    const asOrgA = await listFeatureRequests(orgA.id, userA.id);
    expect(asOrgA.some((r) => r.title === "Org B only")).toBe(false);
  });
});
