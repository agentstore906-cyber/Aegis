"use client";

import { useActionState } from "react";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { updateOrganizationGeneralAction, type OrganizationSettingsState } from "@/lib/organizations/actions";

const initialState: OrganizationSettingsState = {};

export function GeneralSettingsForm({ name }: { name: string }) {
  const [state, formAction, pending] = useActionState(updateOrganizationGeneralAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.success && <Alert tone="success">Saved.</Alert>}

      <div className="max-w-sm">
        <Label htmlFor="orgName">Organization name</Label>
        <Input id="orgName" name="name" required minLength={2} maxLength={80} defaultValue={name} />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
