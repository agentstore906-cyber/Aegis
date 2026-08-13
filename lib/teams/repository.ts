import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export class DuplicateTeamNameError extends Error {
  constructor() {
    super("A team with this name already exists.");
    this.name = "DuplicateTeamNameError";
  }
}

export async function listTeams(organizationId: string) {
  return prisma.team.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { agents: true } } },
  });
}

export async function getTeam(organizationId: string, id: string) {
  return prisma.team.findFirst({ where: { id, organizationId } });
}

export async function createTeam(organizationId: string, name: string) {
  try {
    return await prisma.team.create({ data: { organizationId, name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateTeamNameError();
    }
    throw error;
  }
}

export async function renameTeam(organizationId: string, id: string, name: string) {
  try {
    const result = await prisma.team.updateMany({ where: { id, organizationId }, data: { name } });
    return result.count > 0;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateTeamNameError();
    }
    throw error;
  }
}

/** Deleting a team un-assigns its agents (Agent.teamId onDelete: SetNull) rather than touching the agents themselves. */
export async function deleteTeam(organizationId: string, id: string) {
  const result = await prisma.team.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
