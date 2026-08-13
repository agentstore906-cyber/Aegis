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
import { recordAuditEvent } from "@/lib/audit/service";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/types";
import { trackEvent } from "@/lib/analytics/track";

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
  const { organization, user, role } = await requireActiveOrganization();
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
    await prisma.$transaction(async (tx) => {
      const permission = await repo.createAgentPermission(
        organization.id,
        agent.id,
        {
          action: parsed.data.action,
          resource: parsed.data.resource || "",
          decision: parsed.data.decision,
          description: parsed.data.description || null,
        },
        tx
      );
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        agentId: agent.id,
        eventType: AUDIT_EVENT_TYPES.PERMISSION_CREATED,
        entityType: "AgentPermission",
        entityId: permission.id,
        action: permission.action,
        metadata: { resource: permission.resource, decision: permission.decision },
      });
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
  const { organization, user, role } = await requireActiveOrganization();
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
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await repo.updateAgentPermission(
        organization.id,
        permissionId,
        {
          action: parsed.data.action,
          resource: parsed.data.resource || "",
          decision: parsed.data.decision,
          description: parsed.data.description || null,
        },
        tx
      );
      if (!updated) return null;
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        agentId: updated.agentId,
        eventType: AUDIT_EVENT_TYPES.PERMISSION_UPDATED,
        entityType: "AgentPermission",
        entityId: updated.id,
        action: updated.action,
        metadata: { resource: updated.resource, decision: updated.decision },
      });
      return updated;
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
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgentPermissions(role)) {
    throw new Error("You don't have permission to manage agent permissions.");
  }

  const permission = await repo.getAgentPermission(organization.id, permissionId);

  await prisma.$transaction(async (tx) => {
    const deleted = await repo.deleteAgentPermission(organization.id, permissionId, tx);
    if (deleted && permission) {
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        agentId: permission.agentId,
        eventType: AUDIT_EVENT_TYPES.PERMISSION_DELETED,
        entityType: "AgentPermission",
        entityId: permission.id,
        action: permission.action,
        metadata: { resource: permission.resource, decision: permission.decision },
      });
    }
  });

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

  const policy = await prisma.$transaction(async (tx) => {
    const policy = await repo.createPolicy(organization.id, user.id, parsed.data, tx);
    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: policy.agentId,
      eventType: AUDIT_EVENT_TYPES.POLICY_CREATED,
      entityType: "Policy",
      entityId: policy.id,
      action: policy.action,
      metadata: { name: policy.name, decision: policy.decision },
    });
    return policy;
  });

  trackEvent("policy_created", { organizationId: organization.id });
  revalidatePath("/policies");
  redirect(`/policies/${policy.id}/edit`);
}

export async function updatePolicyAction(
  policyId: string,
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

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await repo.updatePolicy(organization.id, policyId, parsed.data, tx);
    if (!updated) return null;
    await recordAuditEvent(tx, {
      organizationId: organization.id,
      actorType: "USER",
      actorUserId: user.id,
      agentId: updated.agentId,
      eventType: AUDIT_EVENT_TYPES.POLICY_UPDATED,
      entityType: "Policy",
      entityId: updated.id,
      action: updated.action,
      metadata: { name: updated.name, decision: updated.decision },
    });
    return updated;
  });
  if (!updated) return { error: "Policy not found" };

  revalidatePath("/policies");
  revalidatePath(`/policies/${policyId}/edit`);
  redirect(`/policies`);
}

export async function setPolicyStatusAction(policyId: string, status: "ACTIVE" | "DISABLED") {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    throw new Error("You don't have permission to manage policies.");
  }

  const policy = await repo.getPolicy(organization.id, policyId);

  await prisma.$transaction(async (tx) => {
    const changed = await repo.setPolicyStatus(organization.id, policyId, status, tx);
    if (changed && policy) {
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        agentId: policy.agentId,
        eventType: status === "ACTIVE" ? AUDIT_EVENT_TYPES.POLICY_ENABLED : AUDIT_EVENT_TYPES.POLICY_DISABLED,
        entityType: "Policy",
        entityId: policy.id,
        action: policy.action,
        metadata: { name: policy.name },
      });
    }
  });

  revalidatePath("/policies");
}

export async function deletePolicyAction(policyId: string) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManagePolicies(role)) {
    throw new Error("You don't have permission to manage policies.");
  }

  const policy = await repo.getPolicy(organization.id, policyId);

  await prisma.$transaction(async (tx) => {
    const deleted = await repo.deletePolicy(organization.id, policyId, tx);
    if (deleted && policy) {
      await recordAuditEvent(tx, {
        organizationId: organization.id,
        actorType: "USER",
        actorUserId: user.id,
        agentId: policy.agentId,
        eventType: AUDIT_EVENT_TYPES.POLICY_DELETED,
        entityType: "Policy",
        entityId: policy.id,
        action: policy.action,
        metadata: { name: policy.name },
      });
    }
  });

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
