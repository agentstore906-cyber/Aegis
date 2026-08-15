"use server";

import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { requireUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/admin/authorization";
import { createFeatureRequestSchema, updateFeatureRequestStatusSchema } from "@/lib/validation/feedback";
import { trackEvent } from "@/lib/analytics/track";
import * as repo from "@/lib/feedback/repository";

export type SubmitFeatureRequestState = { error?: string };

export async function submitFeatureRequestAction(
  _prevState: SubmitFeatureRequestState,
  formData: FormData
): Promise<SubmitFeatureRequestState> {
  const { organization, user } = await requireActiveOrganization();

  const parsed = createFeatureRequestSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid submission" };

  await repo.createFeatureRequest(organization.id, user.id, parsed.data);
  trackEvent("feature_request_submitted", { organizationId: organization.id });

  revalidatePath("/feedback");
  return {};
}

export async function toggleFeatureRequestVoteAction(featureRequestId: string) {
  const { organization, user } = await requireActiveOrganization();
  await repo.toggleVote(organization.id, featureRequestId, user.id);
  revalidatePath("/feedback");
}

/** Platform-admin only — mirrors lib/leads/actions.ts's setLeadStatusAction. */
export async function setFeatureRequestStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) throw new Error("Not authorized");

  const parsed = updateFeatureRequestStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Invalid status update");

  await repo.setFeatureRequestStatus(parsed.data.id, parsed.data.status);
  revalidatePath("/admin/feedback");
}
