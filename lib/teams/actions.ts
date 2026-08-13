"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageTeams } from "@/lib/teams/authorization";
import { teamNameSchema } from "@/lib/validation/team";
import * as repo from "@/lib/teams/repository";
import { DuplicateTeamNameError } from "@/lib/teams/repository";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";

export type TeamFormState = { error?: string };

export async function createTeamAction(_prevState: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageTeams(role)) return { error: "You don't have permission to manage teams." };

  const parsed = teamNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid team name" };

  try {
    const team = await repo.createTeam(organization.id, parsed.data.name);
    await recordAuditEvent(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      eventType: AUDIT_EVENT_TYPES.TEAM_CREATED,
      entityType: "Team",
      entityId: team.id,
      action: "team.create",
      metadata: { name: team.name },
    });
  } catch (error) {
    if (error instanceof DuplicateTeamNameError) return { error: error.message };
    throw error;
  }

  revalidatePath("/settings/organization");
  return {};
}

export async function deleteTeamAction(id: string) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageTeams(role)) throw new Error("You don't have permission to manage teams.");

  await repo.deleteTeam(organization.id, id);
  revalidatePath("/settings/organization");
  revalidatePath("/costs");
}
