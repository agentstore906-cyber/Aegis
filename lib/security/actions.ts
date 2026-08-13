"use server";

import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canResolveSecurityAlerts } from "@/lib/security/authorization";
import * as repo from "@/lib/security/repository";
import { SecurityAlertAlreadyResolvedError, SecurityAlertNotFoundError } from "@/lib/security/types";

export type SecurityAlertActionState = { error?: string };

export async function acknowledgeSecurityAlertAction(id: string): Promise<SecurityAlertActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canResolveSecurityAlerts(role)) {
    return { error: "You don't have permission to acknowledge security alerts." };
  }

  try {
    await repo.acknowledgeAlert(organization.id, id, user.id);
  } catch (error) {
    if (error instanceof SecurityAlertNotFoundError || error instanceof SecurityAlertAlreadyResolvedError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/security");
  revalidatePath(`/security/${id}`);
  return {};
}

export async function resolveSecurityAlertAction(id: string): Promise<SecurityAlertActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canResolveSecurityAlerts(role)) {
    return { error: "You don't have permission to resolve security alerts." };
  }

  try {
    await repo.resolveAlert(organization.id, id, user.id);
  } catch (error) {
    if (error instanceof SecurityAlertNotFoundError || error instanceof SecurityAlertAlreadyResolvedError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/security");
  revalidatePath(`/security/${id}`);
  revalidatePath("/overview");
  return {};
}
