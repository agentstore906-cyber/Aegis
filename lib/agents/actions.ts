"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { ensureUniqueAgentSlug } from "@/lib/agents/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { createAgentSchema, updateAgentSchema } from "@/lib/validation/agent";
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { trackEvent } from "@/lib/analytics/track";
import { canCreateAgent } from "@/lib/billing/entitlements";

export type CreateAgentState = {
  error?: string;
};

/** Resolves a client-supplied teamId to a real, org-scoped team — never trusts it blindly. Empty/invalid -> null (no team). */
async function resolveTeamId(organizationId: string, teamId: string | undefined): Promise<string | null> {
  if (!teamId) return null;
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  return team?.id ?? null;
}

export async function createAgentAction(
  _prevState: CreateAgentState,
  formData: FormData
): Promise<CreateAgentState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) {
    return { error: "You don't have permission to create agents." };
  }

  const agentCount = await prisma.agent.count({ where: { organizationId: organization.id } });
  const entitlement = canCreateAgent(organization.plan, agentCount);
  if (!entitlement.allowed) return { error: entitlement.reason };

  const parsed = createAgentSchema.safeParse({
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
  const slug = await ensureUniqueAgentSlug(organization.id, parsed.data.name);

  const agent = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        organizationId: organization.id,
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
        owner: parsed.data.owner,
        teamId,
        environment: parsed.data.environment,
        modelProvider: parsed.data.modelProvider,
        modelName: parsed.data.modelName,
        riskLevel: parsed.data.riskLevel,
        status: "ACTIVE",
      },
    });

    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: agent.id,
      eventType: AUDIT_EVENT_TYPES.AGENT_CREATED,
      entityType: "Agent",
      entityId: agent.id,
      action: "agent.create",
      metadata: { name: agent.name },
    });

    return agent;
  });

  trackEvent("agent_connected", { organizationId: organization.id, agentId: agent.id });

  revalidatePath("/agents");
  redirect(`/agents/${agent.slug}`);
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

export async function setAgentStatusAction(agentSlug: string, status: "ACTIVE" | "PAUSED") {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) {
    throw new Error("You don't have permission to pause or resume agents.");
  }

  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId: organization.id, slug: agentSlug } },
  });
  if (!agent) return;

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: { status },
    });

    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: agent.id,
      eventType: status === "PAUSED" ? AUDIT_EVENT_TYPES.AGENT_PAUSED : AUDIT_EVENT_TYPES.AGENT_RESUMED,
      entityType: "Agent",
      entityId: agent.id,
      action: status === "PAUSED" ? "agent.pause" : "agent.resume",
    });
  });

  if (status === "PAUSED") {
    await dispatchWebhookEvent(organization.id, "agent.paused", { agentId: agent.id, agentName: agent.name });
  }

  revalidatePath("/agents");
  revalidatePath(`/agents/${agentSlug}`);
}
