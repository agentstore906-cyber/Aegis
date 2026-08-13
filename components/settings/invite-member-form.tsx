"use client";

import { useActionState, useState } from "react";
import { Label, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CopyButton } from "@/components/ui/copy-button";
import { inviteMemberAction, type InviteMemberState } from "@/lib/organizations/actions";
import { MEMBER_ROLES } from "@/lib/validation/organization";

const initialState: InviteMemberState = {};

export function InviteMemberForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, initialState);
  const [dismissed, setDismissed] = useState(false);

  if (state.inviteUrl && !dismissed) {
    const fullUrl = `${origin}${state.inviteUrl}`;
    return (
      <div className="rounded-lg border border-warning-border bg-warning-bg p-4">
        <p className="text-sm font-medium text-foreground">Invitation created. Share this link — it isn&rsquo;t emailed automatically.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground">
            {fullUrl}
          </code>
          <CopyButton value={fullUrl} label="Copy link" />
        </div>
        <Button type="button" size="sm" className="mt-3" onClick={() => setDismissed(true)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setDismissed(false);
        formAction(formData);
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      {state.error && (
        <div className="w-full sm:order-last">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <div className="flex-1">
        <Label htmlFor="inviteEmail">Email</Label>
        <Input id="inviteEmail" name="email" type="email" required placeholder="teammate@company.com" />
      </div>
      <div className="sm:w-40">
        <Label htmlFor="inviteRole">Role</Label>
        <Select id="inviteRole" name="role" defaultValue="ENGINEER">
          {MEMBER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role.charAt(0) + role.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create invite link"}
      </Button>
    </form>
  );
}
