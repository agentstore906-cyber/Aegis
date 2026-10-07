"use server";

import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { canManageAgents } from "@/lib/agents/authorization";
import { AgentNotScannableError, runAgentScan } from "@/lib/scanner/agent-scan";

/** Scans one agent of the caller's organization. The agent is named by slug and resolved inside that organization. */
export async function runAgentScanAction(agentSlug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canManageAgents(role)) return { ok: false, error: "You don't have permission to scan agents." };
  if (typeof agentSlug !== "string" || agentSlug.length === 0 || agentSlug.length > 120) return { ok: false, error: "Agent not found." };
  try {
    await runAgentScan({ organizationId: organization.id, agentSlug, userId: user.id });
    revalidatePath(`/agents/${agentSlug}`);
    revalidatePath("/risk-scan");
    return { ok: true };
  } catch (error) {
    if (error instanceof AgentNotScannableError) return { ok: false, error: error.message };
    throw error;
  }
}
