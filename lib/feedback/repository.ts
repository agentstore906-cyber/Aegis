import "server-only";

import { prisma } from "@/lib/db";
import type { CreateFeatureRequestInput } from "@/lib/validation/feedback";
import type { FeatureRequestStatus } from "@prisma/client";

export async function createFeatureRequest(organizationId: string, userId: string, input: CreateFeatureRequestInput) {
  return prisma.featureRequest.create({
    data: { organizationId, userId, ...input },
  });
}

/** Org-scoped list, each row annotated with its real vote count and whether the current user has voted — never a client-supplied count. */
export async function listFeatureRequests(organizationId: string, currentUserId: string) {
  const requests = await prisma.featureRequest.findMany({
    where: { organizationId },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      votes: { where: { userId: currentUserId }, select: { userId: true } },
      _count: { select: { votes: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return requests.map((request) => ({
    ...request,
    voteCount: request._count.votes,
    hasVoted: request.votes.length > 0,
  }));
}

/**
 * Toggles the current user's vote (create if absent, delete if present),
 * scoped to a request that actually belongs to the caller's organization —
 * never trusts a bare featureRequestId without that check.
 */
export async function toggleVote(organizationId: string, featureRequestId: string, userId: string) {
  const request = await prisma.featureRequest.findFirst({
    where: { id: featureRequestId, organizationId },
    select: { id: true },
  });
  if (!request) return null;

  const existing = await prisma.featureRequestVote.findUnique({
    where: { featureRequestId_userId: { featureRequestId, userId } },
  });

  if (existing) {
    await prisma.featureRequestVote.delete({ where: { id: existing.id } });
    return { voted: false };
  }

  await prisma.featureRequestVote.create({ data: { featureRequestId, userId } });
  return { voted: true };
}

// --- Platform-admin triage (mirrors lib/leads/repository.ts's setLeadStatus shape) ---

export async function listAllFeatureRequests() {
  return prisma.featureRequest.findMany({
    include: {
      organization: { select: { id: true, name: true } },
      submittedBy: { select: { id: true, name: true, email: true } },
      _count: { select: { votes: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function setFeatureRequestStatus(id: string, status: FeatureRequestStatus) {
  const result = await prisma.featureRequest.updateMany({ where: { id }, data: { status } });
  return result.count > 0;
}
