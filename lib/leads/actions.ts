"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/admin/authorization";
import { getClientIp } from "@/lib/http/client-ip";
import { submitLead } from "@/lib/leads/service";
import { updateLeadStatusSchema } from "@/lib/validation/lead";
import * as repo from "@/lib/leads/repository";
import { trackEvent } from "@/lib/analytics/track";

export type SubmitLeadState = { error?: string; success?: boolean };

export async function submitLeadAction(_prevState: SubmitLeadState, formData: FormData): Promise<SubmitLeadState> {
  const ip = await getClientIp();
  const result = await submitLead(
    {
      name: formData.get("name"),
      email: formData.get("email"),
      company: formData.get("company"),
      role: formData.get("role"),
      agentCount: formData.get("agentCount") || undefined,
      aiStack: formData.get("aiStack") || undefined,
      primaryChallenge: formData.get("primaryChallenge") || undefined,
      message: formData.get("message") || undefined,
      source: formData.get("source") || "CONTACT",
    },
    String(formData.get("website") ?? ""),
    ip
  );

  if (!result.ok) return { error: result.error };
  trackEvent("demo_requested", { source: String(formData.get("source") ?? "CONTACT") });
  return { success: true };
}

export async function setLeadStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) throw new Error("Not authorized");

  const parsed = updateLeadStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Invalid status update");

  await repo.setLeadStatus(parsed.data.id, parsed.data.status);
  revalidatePath("/admin/leads");
}
