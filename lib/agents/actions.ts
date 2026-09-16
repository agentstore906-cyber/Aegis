"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { updateAgentSchema } from "@/lib/validation/agent";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import {
  setAgentControlState,
  AgentNotFoundError,
  AgentArchivedError,
  type AgentControlState,
} from "@/lib/agents/control";
import type { EnforcementOutcome } from "@/lib/enforcement/types";

/** Resolves a client-supplied teamId to a real, org-scoped team — never trusts it blindly. Empty/invalid -> null (no team). */
async function resolveTeamId(organizationId: string, teamId: string | undefined): Promise<string | null> {
  if (!teamId) return null;
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  return team?.id ?? null;
}

export type UpdateAgentState = {
  error?: string;
};

export async function updateAgentAction(
  agentSlug: string,
  _prevState: UpdateAgentState,
  formData: FormData
): Promise<UpdateAgentState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) {
    return { error: "You don't have permission to edit agents." };
  }

  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId: organization.id, slug: agentSlug } },
  });
  if (!agent) {
    return { error: "Agent not found" };
  }

  const parsed = updateAgentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    owner: formData.get("owner"),
    teamId: formData.get("teamId") ?? "",
    environment: formData.get("environment"),
    modelProvider: formData.get("modelProvider"),
    modelName: formData.get("modelName"),
    riskLevel: formData.get("riskLevel"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid agent details" };
  }

  const teamId = await resolveTeamId(organization.id, parsed.data.teamId);

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        owner: parsed.data.owner,
        teamId,
        environment: parsed.data.environment,
        modelProvider: parsed.data.modelProvider,
        modelName: parsed.data.modelName,
        riskLevel: parsed.data.riskLevel,
      },
    });

    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: agent.id,
      eventType: AUDIT_EVENT_TYPES.AGENT_UPDATED,
      entityType: "Agent",
      entityId: agent.id,
      action: "agent.update",
      metadata: { name: parsed.data.name },
    });
  });

  revalidatePath("/agents");
  revalidatePath(`/agents/${agentSlug}`);
  redirect(`/agents/${agentSlug}`);
}

export type { AgentControlState } from "@/lib/agents/control";
export type SetAgentStatusResult = { error?: string; outcome?: EnforcementOutcome };

/**
 * The kill switch. Thin session/role-checking wrapper around
 * setAgentControlState() (lib/agents/control.ts), which holds the actual
 * transaction/audit/enforcement logic — see its docstring.
 */
export async function setAgentStatusAction(
  agentSlug: string,
  status: AgentControlState,
  reason?: string
): Promise<SetAgentStatusResult> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) {
    return { error: "You don't have permission to control this agent." };
  }

  try {
    const result = await setAgentControlState(organization.id, agentSlug, status, user.id, reason);
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentSlug}`);
    revalidatePath("/overview");
    return { outcome: result.outcome };
  } catch (error) {
    if (error instanceof AgentNotFoundError || error instanceof AgentArchivedError) {
      return { error: error.message };
    }
    throw error;
  }
}
