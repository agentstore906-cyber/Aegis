"use server";

import { revalidatePath } from "next/cache";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { hasCapability } from "@/lib/rbac/capabilities";
import { labelRiskDecision } from "@/lib/risk/analytics";
import { disableRiskControl, updateRiskControlSettings } from "@/lib/risk/settings";
import { HIGH_ACTION_OPTIONS, MEDIUM_ACTION_OPTIONS } from "@/lib/risk/control";

export type RiskControlActionState = { error?: string; success?: string };

const MODES = ["OBSERVE", "APPROVAL_REQUIRED", "ENFORCE"] as const;
const LABELS = ["JUSTIFIED", "FALSE_POSITIVE", "UNSURE"] as const;

function oneOf<T extends string>(value: FormDataEntryValue | null, options: readonly T[]): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
}

export async function updateRiskControlAction(_prev: RiskControlActionState, formData: FormData): Promise<RiskControlActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!hasCapability(role, "manage_risk_control")) return { error: "You do not have permission to change risk control." };

  const mode = oneOf(formData.get("mode"), MODES);
  const mediumAction = oneOf(formData.get("mediumAction"), MEDIUM_ACTION_OPTIONS);
  const highAction = oneOf(formData.get("highAction"), HIGH_ACTION_OPTIONS);
  if (!mode || !mediumAction || !highAction) return { error: "Choose a mode and an action for medium and high risk." };

  const result = await updateRiskControlSettings({
    organizationId: organization.id,
    actorUserId: user.id,
    next: { mode, mediumAction, highAction },
    confirmedEnforcement: formData.get("confirm") === "on",
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/risk-control");
  return { success: result.changed ? "Risk control settings saved." : "No changes." };
}

export async function disableRiskControlAction(_prev: RiskControlActionState): Promise<RiskControlActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!hasCapability(role, "manage_risk_control")) return { error: "You do not have permission to change risk control." };
  const result = await disableRiskControl(organization.id, user.id);
  if (!result.ok) return { error: result.error };
  revalidatePath("/risk-control");
  return { success: "Risk enforcement is off. Decisions are observed only; all history is kept." };
}

export async function labelRiskDecisionAction(
  evaluationId: string,
  _prev: RiskControlActionState,
  formData: FormData
): Promise<RiskControlActionState> {
  const { organization, user, role } = await requireActiveOrganization();
  if (!hasCapability(role, "resolve_security")) return { error: "You do not have permission to review risk decisions." };
  const label = oneOf(formData.get("label"), LABELS);
  if (!label) return { error: "Choose a label." };
  const note = formData.get("note");
  const result = await labelRiskDecision({
    organizationId: organization.id,
    evaluationId,
    reviewerId: user.id,
    label,
    note: typeof note === "string" ? note : undefined,
  });
  if (!result.ok) return { error: result.error === "NOT_FOUND" ? "Decision not found." : "This decision has no risk assessment to review." };
  revalidatePath("/risk-control");
  return { success: "Saved." };
}
