import "server-only";

import { randomBytes } from "node:crypto";
import type { MemberRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { InvitationExpiredError, InvitationNotFoundError, PrivilegeEscalationError } from "@/lib/organizations/errors";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateInvitationToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function listPendingInvitations(organizationId: string) {
  return prisma.organizationInvitation.findMany({
    where: { organizationId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Only an existing OWNER can invite someone as OWNER — same escalation rule as changeMemberRole. */
export async function createInvitation(
  organizationId: string,
  invitedByUserId: string,
  invitedByRole: MemberRole,
  email: string,
  role: MemberRole
) {
  if (role === "OWNER" && invitedByRole !== "OWNER") {
    throw new PrivilegeEscalationError();
  }

  return prisma.organizationInvitation.create({
    data: {
      organizationId,
      email: email.toLowerCase(),
      role,
      token: generateInvitationToken(),
      invitedByUserId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });
}

export async function revokeInvitation(organizationId: string, id: string) {
  const result = await prisma.organizationInvitation.deleteMany({ where: { id, organizationId, acceptedAt: null } });
  return result.count > 0;
}

export async function getInvitationByToken(token: string) {
  return prisma.organizationInvitation.findUnique({
    where: { token },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
}

/**
 * Accepts an invitation for the given (already-authenticated) user.
 * Callers must have already verified the signed-in user's email matches
 * the invitation — this function trusts `userId` as given, same as every
 * other mutation trusting the caller's authenticated session rather than
 * client-supplied identity.
 */
export async function acceptInvitation(token: string, userId: string) {
  const invitation = await prisma.organizationInvitation.findUnique({ where: { token } });
  if (!invitation) throw new InvitationNotFoundError();
  if (invitation.acceptedAt) throw new InvitationExpiredError();
  if (invitation.expiresAt <= new Date()) throw new InvitationExpiredError();

  const [organization] = await prisma.$transaction([
    prisma.organization.findUniqueOrThrow({ where: { id: invitation.organizationId } }),
    prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
      update: {},
      create: { organizationId: invitation.organizationId, userId, role: invitation.role },
    }),
    prisma.organizationInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
  ]);

  return organization;
}
