"use client";

import { useActionState } from "react";
import { Label, Input, FieldHint } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { updateRetentionSettingsAction, type OrganizationSettingsState } from "@/lib/organizations/actions";

const initialState: OrganizationSettingsState = {};

export function RetentionSettingsForm({
  activityRetentionDays,
  auditRetentionDays,
  securityRetentionDays,
}: {
  activityRetentionDays: number | null;
  auditRetentionDays: number | null;
  securityRetentionDays: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateRetentionSettingsAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">Saved.</Alert>}

      <Alert tone="warning">
        These settings are configuration only — nothing is automatically deleted yet. See{" "}
        <code>docs/retention.md</code> for what&rsquo;s actually enforced today.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="activityRetentionDays">Activity (days)</Label>
          <Input
            id="activityRetentionDays"
            name="activityRetentionDays"
            type="number"
            min={1}
            max={3650}
            placeholder="Unlimited"
            defaultValue={activityRetentionDays ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="auditRetentionDays">Audit trail (days)</Label>
          <Input
            id="auditRetentionDays"
            name="auditRetentionDays"
            type="number"
            min={1}
            max={3650}
            placeholder="Unlimited"
            defaultValue={auditRetentionDays ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="securityRetentionDays">Security alerts (days)</Label>
          <Input
            id="securityRetentionDays"
            name="securityRetentionDays"
            type="number"
            min={1}
            max={3650}
            placeholder="Unlimited"
            defaultValue={securityRetentionDays ?? ""}
          />
        </div>
      </div>
      <FieldHint>Leave blank for no configured limit.</FieldHint>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
