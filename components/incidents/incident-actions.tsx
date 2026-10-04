"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import {
  acknowledgeIncidentAction,
  addIncidentNoteAction,
  changeIncidentStatusAction,
  openIncidentAction,
  type IncidentActionState,
} from "@/lib/incidents/actions";
import { STATUS_TRANSITIONS } from "@/lib/incidents/status";
import type { AnchorType } from "@/lib/incidents/types";

const initial: IncidentActionState = {};
const STATUS_LABEL = { OPEN: "Open", INVESTIGATING: "Investigating", RESOLVED: "Resolved", FALSE_POSITIVE: "False positive" } as const;
type Status = keyof typeof STATUS_LABEL;

/** "Investigate as incident" — safe to press twice: it opens the run's incident or jumps to the one that exists. */
export function OpenIncidentButton({ anchorType, anchorId }: { anchorType: AnchorType; anchorId: string }) {
  const [state, action, pending] = useActionState(() => openIncidentAction(anchorType, anchorId), initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Opening…" : "Investigate as incident"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export function AcknowledgeButton({ incidentId, acknowledgedBy }: { incidentId: string; acknowledgedBy: string | null }) {
  const [state, action, pending] = useActionState(acknowledgeIncidentAction.bind(null, incidentId), initial);
  if (acknowledgedBy) return <span className="text-xs text-muted-foreground">Acknowledged by {acknowledgedBy}</span>;
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Acknowledging…" : "Acknowledge"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export function StatusForm({ incidentId, status }: { incidentId: string; status: Status }) {
  const [state, action, pending] = useActionState(changeIncidentStatusAction.bind(null, incidentId), initial);
  const [to, setTo] = useState<string>("");
  const options = STATUS_TRANSITIONS[status];
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <div>
          <Label htmlFor="status">Move to</Label>
          <Select id="status" name="status" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {status === "RESOLVED" || status === "FALSE_POSITIVE" ? "Reopen" : STATUS_LABEL[o]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="note">{to === "FALSE_POSITIVE" ? "Why is this a false positive? (required)" : "Note (optional)"}</Label>
          <Textarea id="note" name="note" rows={2} maxLength={2000} required={to === "FALSE_POSITIVE"} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Changing status never alters the evidence or the original security alert, and every change stays in the activity log.
      </p>
      <Button type="submit" size="sm" disabled={pending || !to}>
        {pending ? "Saving…" : "Update status"}
      </Button>
    </form>
  );
}

export function NoteForm({ incidentId }: { incidentId: string }) {
  const [state, action, pending] = useActionState(addIncidentNoteAction.bind(null, incidentId), initial);
  return (
    <form action={action} className="space-y-2">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <Label htmlFor="incident-note">Add a note</Label>
      <Textarea id="incident-note" name="note" rows={2} maxLength={2000} required />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add note"}
      </Button>
    </form>
  );
}
