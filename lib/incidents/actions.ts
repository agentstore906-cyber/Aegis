"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { IncidentStatus } from "@prisma/client";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { IncidentForbiddenError, IncidentNotFoundError, IncidentTransitionError, type IncidentActor } from "@/lib/incidents/authorization";
import { acknowledgeIncident, addIncidentNote, changeIncidentStatus, openIncident } from "@/lib/incidents/service";
import type { AnchorType } from "@/lib/incidents/types";

export type IncidentActionState = { error?: string; success?: string };

const STATUSES: readonly IncidentStatus[] = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];
const ANCHORS: readonly AnchorType[] = ["SECURITY_ALERT", "POLICY_EVALUATION", "ACTIVITY_EVENT"];

async function actor(): Promise<IncidentActor> {
  const { organization, user, role } = await requireActiveOrganization();
  return { organizationId: organization.id, userId: user.id, role };
}

function message(error: unknown): string {
  if (error instanceof IncidentForbiddenError || error instanceof IncidentTransitionError) return error.message;
  if (error instanceof IncidentNotFoundError) return "That incident or record was not found.";
  console.error(JSON.stringify({ msg: "incident_action_failed", error: String(error) }));
  return "Something went wrong. Nothing was changed.";
}

/** Open (or jump to) the incident for a record an operator is looking at. */
export async function openIncidentAction(anchorType: AnchorType, anchorId: string): Promise<IncidentActionState> {
  if (!ANCHORS.includes(anchorType)) return { error: "Unknown record type." };
  let incidentId: string;
  try {
    const result = await openIncident(await actor(), { anchorType, anchorId });
    incidentId = result.incident.id;
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath("/incidents");
  redirect(`/incidents/${incidentId}`);
}

export async function acknowledgeIncidentAction(incidentId: string, _prev: IncidentActionState): Promise<IncidentActionState> {
  try {
    const { acknowledged } = await acknowledgeIncident(await actor(), incidentId);
    revalidatePath(`/incidents/${incidentId}`);
    return { success: acknowledged ? "Acknowledged." : "Already acknowledged." };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function changeIncidentStatusAction(incidentId: string, _prev: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  const to = formData.get("status");
  if (typeof to !== "string" || !(STATUSES as readonly string[]).includes(to)) return { error: "Choose a status." };
  const note = formData.get("note");
  try {
    await changeIncidentStatus(await actor(), incidentId, to as IncidentStatus, typeof note === "string" ? note : undefined);
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath("/incidents");
    return { success: "Status updated." };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function addIncidentNoteAction(incidentId: string, _prev: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  const note = formData.get("note");
  try {
    await addIncidentNote(await actor(), incidentId, typeof note === "string" ? note : "");
    revalidatePath(`/incidents/${incidentId}`);
    return { success: "Note added." };
  } catch (error) {
    return { error: message(error) };
  }
}
