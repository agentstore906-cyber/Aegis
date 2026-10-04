import type { IncidentStatus } from "@prisma/client";

/**
 * Incident status — handling state only. Changing it never touches the
 * evidence or the security records an incident describes (alerts keep their
 * own status), and every change is an append-only IncidentActivity row.
 *
 *   OPEN ──► INVESTIGATING ──► RESOLVED
 *     │            │    └─────► FALSE_POSITIVE
 *     ├───────────────────────► RESOLVED
 *     └───────────────────────► FALSE_POSITIVE
 *   INVESTIGATING ──► OPEN          (back to the queue)
 *   RESOLVED / FALSE_POSITIVE ──► OPEN   (reopen; the only way out of a closed state)
 *
 * Closed states cannot jump to each other: reopening first makes the second
 * judgement a visible, separate step. FALSE_POSITIVE requires a note — it is
 * the only label the product has about whether detection was right, so it must
 * say why.
 */
export const STATUS_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ["INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"],
  INVESTIGATING: ["OPEN", "RESOLVED", "FALSE_POSITIVE"],
  RESOLVED: ["OPEN"],
  FALSE_POSITIVE: ["OPEN"],
};

export const CLOSED_STATUSES: readonly IncidentStatus[] = ["RESOLVED", "FALSE_POSITIVE"];
export const MAX_NOTE_LENGTH = 2000;

export type TransitionCheck = { ok: true } | { ok: false; code: "NO_CHANGE" | "NOT_ALLOWED" | "NOTE_REQUIRED" | "NOTE_TOO_LONG"; message: string };

export function checkTransition(from: IncidentStatus, to: IncidentStatus, note: string | undefined | null): TransitionCheck {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > MAX_NOTE_LENGTH) return { ok: false, code: "NOTE_TOO_LONG", message: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` };
  if (from === to) return { ok: false, code: "NO_CHANGE", message: `The incident is already ${label(to)}.` };
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    return { ok: false, code: "NOT_ALLOWED", message: `An incident cannot move from ${label(from)} to ${label(to)}${CLOSED_STATUSES.includes(from) ? " — reopen it first" : ""}.` };
  }
  if (to === "FALSE_POSITIVE" && trimmed.length === 0) {
    return { ok: false, code: "NOTE_REQUIRED", message: "Explain why this is a false positive." };
  }
  return { ok: true };
}

export function label(status: IncidentStatus): string {
  return status.replaceAll("_", " ").toLowerCase();
}
