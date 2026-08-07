"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { createAgentSchema, updateAgentSchema } from "@/lib/validation/agent";
import { slugify } from "@/lib/utils";

export type CreateAgentState = {
  error?: string;
};

async function uniqueAgentSlug(organizationId: string, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;

  while (
    await prisma.agent.findUnique({
      where: { organizationId_slug: { organizationId, slug: candidate } },
    })
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function createAgentAction(
  _prevState: CreateAgentState,
  formData: FormData
): Promise<CreateAgentState> {
  const { organization } = await requireActiveOrganization();

  const parsed = createAgentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    owner: formData.get("owner"),
    environment: formData.get("environment"),
    modelProvider: formData.get("modelProvider"),
    modelName: formData.get("modelName"),
    riskLevel: formData.get("riskLevel"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid agent details" };
  }

  const slug = await uniqueAgentSlug(organization.id, parsed.data.name);

  const agent = await prisma.agent.create({
    data: {
      organizationId: organization.id,
      name: parsed.data.name,
      slug,
      description: parsed.data.description || null,
      owner: parsed.data.owner,
      environment: parsed.data.environment,
      modelProvider: parsed.data.modelProvider,
      modelName: parsed.data.modelName,
      riskLevel: parsed.data.riskLevel,
      status: "ACTIVE",
    },
  });

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
  const { organization } = await requireActiveOrganization();

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
    environment: formData.get("environment"),
    modelProvider: formData.get("modelProvider"),
    modelName: formData.get("modelName"),
    riskLevel: formData.get("riskLevel"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid agent details" };
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      owner: parsed.data.owner,
      environment: parsed.data.environment,
      modelProvider: parsed.data.modelProvider,
      modelName: parsed.data.modelName,
      riskLevel: parsed.data.riskLevel,
    },
  });

  revalidatePath("/agents");
  revalidatePath(`/agents/${agentSlug}`);
  redirect(`/agents/${agentSlug}`);
}

export async function setAgentStatusAction(agentSlug: string, status: "ACTIVE" | "PAUSED") {
  const { organization } = await requireActiveOrganization();

  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId: organization.id, slug: agentSlug } },
  });
  if (!agent) return;

  await prisma.agent.update({
    where: { id: agent.id },
    data: { status },
  });

  revalidatePath("/agents");
  revalidatePath(`/agents/${agentSlug}`);
}
