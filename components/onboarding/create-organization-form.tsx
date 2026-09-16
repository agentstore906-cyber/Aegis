"use client";

import { useActionState } from "react";
import { createOrganizationAction, type CreateOrganizationState } from "@/lib/organizations/actions";
import { Label, Input, FieldHint } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const initialState: CreateOrganizationState = {};

export function CreateOrganizationForm({
  accountType = "TEAM",
  placeholder = "Northstar Labs",
}: {
  accountType?: "TEAM" | "ENTERPRISE";
  placeholder?: string;
}) {
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);
  const label = accountType === "ENTERPRISE" ? "Company name" : "Team name";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <input type="hidden" name="accountType" value={accountType} />

      <div>
        <Label htmlFor="name">{label}</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder={placeholder}
          autoComplete="organization"
          required
          minLength={2}
          maxLength={80}
        />
        <FieldHint>This is the workspace your team will use to monitor agents.</FieldHint>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
