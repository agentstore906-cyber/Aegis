"use server";

import { revalidatePath } from "next/cache";

import { canManageAgents } from "@/lib/agents/authorization";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { isScanId, linkScanToAgent } from "@/lib/scanner/service";

export type LinkAgentState = { error?: string; ok?: boolean };

/** Links one of this organization's scans to one of this organization's agents. */
export async function linkScanToAgentAction(_prev: LinkAgentState, formData: FormData): Promise<LinkAgentState> {
  const { organization, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { error: "Only members who can manage agents can link a scan to an agent." };

  const scanId = String(formData.get("scanId") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  if (!isScanId(scanId) || agentId.length === 0 || agentId.length > 64) return { error: "Choose an agent to link." };

  const linked = await linkScanToAgent(organization.id, scanId, agentId);
  if (!linked) return { error: "That agent or scan wasn’t found in this workspace." };

  revalidatePath(`/risk-scan/${scanId}`);
  revalidatePath("/risk-scan");
  return { ok: true };
}
