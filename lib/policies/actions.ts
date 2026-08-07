"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { Environment, RiskLevel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgentPermissions, canManagePolicies } from "@/lib/policies/authorization";
import { agentPermissionSchema } from "@/lib/validation/permission";
import { policySchema } from "@/lib/validation/policy";
import { policyTesterSchema } from "@/lib/validation/tester";
import * as repo from "@/lib/policies/repository";
import { DuplicatePermissionError } from "@/lib/policies/repository";
import { evaluateAgentAction } from "@/lib/policies/evaluate";
import type { PolicyEvaluationResult } from "@/lib/policies/types";

function emptyToUndefined(v: string | undefined): string | undefined {
  return v === "" || v === undefined ? undefined : v;
}

// ---------------------------------------------------------------------------
// Agent permissions
// ---------------------------------------------------------------------------

export type PermissionFormState = { error?: string };

async function resolveAgentForOrg(organizationId: string, agentSlug: string) {
  const agent = await prisma.agent.findUnique({
    where: { organizationId_slug: { organizationId, slug: agentSlug } },
  });
  if (!agent) throw new Error("Agent not found");
  return agent;
}

export async function createAgentPermissionAction(
  agentSlug: string,
  _prevState: PermissionFormState,
  formData: FormData
): Promise<PermissionFormState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgentPermissions(role)) {
    return { error: "You don't have permission to manage agent permissions." };
  }

  const parsed = agentPermissionSchema.safeParse({
    action: formData.get("action"),
    resource: formData.get("resource") ?? "",
    decision: formData.get("decision"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid permission" };
  }

  const agent = await resolveAgentForOrg(organization.id, agentSlug);

  try {
    await repo.createAgentPermission(organization.id, agent.id, {
      action: parsed.data.action,
      resource: parsed.data.resource || "",
      decision: parsed.data.decision,
      description: parsed.data.description || null,
    });
  } catch (error) {
    if (error instanceof DuplicatePermissionError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/agents/${agentSlug}`);
  redirect(`/agents/${agentSlug}?tab=permissions`);
}

export async function updateAgentPermissionAction(
  agentSlug: string,
  permissionId: string,
  _prevState: PermissionFormState,
  formData: FormData
): Promise<PermissionFormState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgentPermissions(role)) {
    return { error: "You don't have permission to manage agent permissions." };
  }

  const parsed = agentPermissionSchema.safeParse({
    action: formData.get("action"),
    resource: formData.get("resource") ?? "",
    decision: formData.get("decision"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid permission" };
  }

  try {
    const updated = await repo.updateAgentPermission(organization.id, permissionId, {
      action: parsed.data.action,
      resource: parsed.data.resource || "",
      decision: parsed.data.decision,
      description: parsed.data.description || null,
    });
    if (!updated) return { error: "Permission not found" };
  } catch (error) {
    if (error instanceof DuplicatePermissionError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/agents/${agentSlug}`);
  redirect(`/agents/${agentSlug}?tab=permissions`);
}

export async function deleteAgentPermissionAction(agentSlug: string, permissionId: string) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgentPermissions(role)) {
    throw new Error("You don't have permission to manage agent permissions.");
  }

  await repo.deleteAgentPermission(organization.id, permissionId);
  revalidatePath(`/agents/${agentSlug}`);
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type PolicyFormState = { error?: string };

function parsePolicyFormData(formData: FormData) {
  let conditionsRaw: unknown = [];
  try {
    conditionsRaw = JSON.parse(String(formData.get("conditionsJson") ?? "[]"));
  } catch {
    return { success: false as const, error: "Invalid condition data" };
  }

  const parsed = policySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    status: formData.get("status"),
    priority: formData.get("priority"),
    decision: formData.get("decision"),
    agentId: formData.get("agentId") ?? "",
    action: formData.get("action"),
    resource: formData.get("resource") ?? "",
    environment: formData.get("environment") ?? "",
    tool: formData.get("tool") ?? "",
    riskLevel: formData.get("riskLevel") ?? "",
    conditions: conditionsRaw,
  });

  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid policy" };
  }

  return {
    success: true as const,
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      decision: parsed.data.decision,
      agentId: parsed.data.agentId || null,
      action: parsed.data.action,
      resource: parsed.data.resource || null,
      environment: parsed.data.environment || null,
      tool: parsed.data.tool || null,
      riskLevel: parsed.data.riskLevel || null,
      conditions: parsed.data.conditions,
    },
  };
}

export async function createPolicyAction(
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    return { error: "You don't have permission to manage policies." };
  }

  const parsed = parsePolicyFormData(formData);
  if (!parsed.success) return { error: parsed.error };

  if (parsed.data.agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: parsed.data.agentId, organizationId: organization.id },
    });
    if (!agent) return { error: "Selected agent was not found in this organization." };
  }

  const policy = await repo.createPolicy(organization.id, user.id, parsed.data);

  revalidatePath("/policies");
  redirect(`/policies/${policy.id}/edit`);
}

export async function updatePolicyAction(
  policyId: string,
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    return { error: "You don't have permission to manage policies." };
  }

  const parsed = parsePolicyFormData(formData);
  if (!parsed.success) return { error: parsed.error };

  if (parsed.data.agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: parsed.data.agentId, organizationId: organization.id },
    });
    if (!agent) return { error: "Selected agent was not found in this organization." };
  }

  const updated = await repo.updatePolicy(organization.id, policyId, parsed.data);
  if (!updated) return { error: "Policy not found" };

  revalidatePath("/policies");
  revalidatePath(`/policies/${policyId}/edit`);
  redirect(`/policies`);
}

export async function setPolicyStatusAction(policyId: string, status: "ACTIVE" | "DISABLED") {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    throw new Error("You don't have permission to manage policies.");
  }

  await repo.setPolicyStatus(organization.id, policyId, status);
  revalidatePath("/policies");
}

export async function deletePolicyAction(policyId: string) {
  const { organization, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    throw new Error("You don't have permission to manage policies.");
  }

  await repo.deletePolicy(organization.id, policyId);
  revalidatePath("/policies");
}

// ---------------------------------------------------------------------------
// Policy tester
// ---------------------------------------------------------------------------

export type PolicyTesterState = {
  error?: string;
  result?: PolicyEvaluationResult;
};

export async function runPolicyTesterAction(
  _prevState: PolicyTesterState,
  formData: FormData
): Promise<PolicyTesterState> {
  const { organization } = await requireActiveOrganization();

  const parsed = policyTesterSchema.safeParse({
    agentId: formData.get("agentId"),
    action: formData.get("action"),
    resource: formData.get("resource") ?? "",
    environment: formData.get("environment") ?? "",
    tool: formData.get("tool") ?? "",
    riskLevel: formData.get("riskLevel") ?? "",
    contextJson: formData.get("contextJson") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const agent = await prisma.agent.findFirst({
    where: { id: parsed.data.agentId, organizationId: organization.id },
  });
  if (!agent) return { error: "Agent not found in this organization." };

  const result = await evaluateAgentAction({
    organizationId: organization.id,
    agentId: parsed.data.agentId,
    action: parsed.data.action,
    resource: emptyToUndefined(parsed.data.resource),
    environment: emptyToUndefined(parsed.data.environment) as Environment | undefined,
    tool: emptyToUndefined(parsed.data.tool),
    riskLevel: emptyToUndefined(parsed.data.riskLevel) as RiskLevel | undefined,
    context: parsed.data.contextJson,
  });

  revalidatePath("/policies/evaluations");
  revalidatePath("/overview");

  return { result };
}
