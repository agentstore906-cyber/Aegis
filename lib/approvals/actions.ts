"use server";

import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canResolveApproval } from "@/lib/approvals/authorization";
import { approvalDecisionSchema } from "@/lib/validation/approval";
import * as service from "@/lib/approvals/service";
import {
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  ApprovalNotFoundError,
} from "@/lib/approvals/types";

export type ApprovalResolutionState = { error?: string; success?: boolean };

async function resolve(
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  formData: FormData
): Promise<ApprovalResolutionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canResolveApproval(role)) {
    return { error: "You don't have permission to resolve approval requests." };
  }

  const parsed = approvalDecisionSchema.safeParse({ comment: formData.get("comment") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid comment" };
  }

  try {
    const updated = await service.resolveApproval(
      organization.id,
      requestId,
      user.id,
      decision,
      parsed.data.comment || undefined
    );

    revalidatePath("/approvals");
    revalidatePath(`/approvals/${requestId}`);
    revalidatePath("/overview");
    revalidatePath(`/agents/${updated.agent.slug}`);

    return { success: true };
  } catch (error) {
    if (
      error instanceof ApprovalNotFoundError ||
      error instanceof ApprovalAlreadyResolvedError ||
      error instanceof ApprovalExpiredError
    ) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function approveApprovalAction(
  requestId: string,
  _prevState: ApprovalResolutionState,
  formData: FormData
): Promise<ApprovalResolutionState> {
  return resolve(requestId, "APPROVED", formData);
}

export async function rejectApprovalAction(
  requestId: string,
  _prevState: ApprovalResolutionState,
  formData: FormData
): Promise<ApprovalResolutionState> {
  return resolve(requestId, "REJECTED", formData);
}
