import "server-only";

import type { MemberRole } from "@prisma/client";
import { prisma, type PrismaOrTx } from "@/lib/db";
import { LastOwnerError, MemberNotFoundError, PrivilegeEscalationError } from "@/lib/organizations/errors";

export async function listMembers(organizationId: string) {
  return prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

async function countOwners(organizationId: string, tx: Pick<typeof prisma, "organizationMember"> = prisma): Promise<number> {
  return tx.organizationMember.count({ where: { organizationId, role: "OWNER" } });
}

/**
 * Changing a member's role. Two guarantees enforced here, not just at the
 * page/action layer: (1) only an existing OWNER can grant or revoke the
 * OWNER role — an ADMIN cannot escalate itself or anyone else to OWNER,
 * and can't demote one either; (2) the organization can never end up with
 * zero Owners.
 *
 * Accepts an optional external transaction client so a caller (e.g. the
 * Server Action) can commit the role change and its audit event
 * atomically. When called standalone, opens its own transaction — Prisma
 * doesn't support nesting `$transaction` inside an already-open one.
 */
export async function changeMemberRole(
  organizationId: string,
  memberId: string,
  newRole: MemberRole,
  actingRole: MemberRole,
  client?: PrismaOrTx
): Promise<void> {
  if (newRole === "OWNER" && actingRole !== "OWNER") {
    throw new PrivilegeEscalationError();
  }

  const run = async (tx: PrismaOrTx) => {
    const member = await tx.organizationMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) throw new MemberNotFoundError();
    if (member.role === newRole) return;

    if (member.role === "OWNER" && newRole !== "OWNER") {
      if (actingRole !== "OWNER") throw new PrivilegeEscalationError();
      if ((await countOwners(organizationId, tx)) <= 1) throw new LastOwnerError();
    }

    await tx.organizationMember.update({ where: { id: memberId }, data: { role: newRole } });
  };

  return client ? run(client) : prisma.$transaction(run);
}

/** Same last-Owner and escalation protections as changeMemberRole, and the same optional-external-transaction shape. */
export async function removeMember(
  organizationId: string,
  memberId: string,
  actingRole: MemberRole,
  client?: PrismaOrTx
): Promise<void> {
  const run = async (tx: PrismaOrTx) => {
    const member = await tx.organizationMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) throw new MemberNotFoundError();

    if (member.role === "OWNER") {
      if (actingRole !== "OWNER") throw new PrivilegeEscalationError();
      if ((await countOwners(organizationId, tx)) <= 1) throw new LastOwnerError();
    }

    await tx.organizationMember.delete({ where: { id: memberId } });
  };

  return client ? run(client) : prisma.$transaction(run);
}
