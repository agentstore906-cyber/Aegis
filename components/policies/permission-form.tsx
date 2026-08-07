"use client";

import { useActionState } from "react";
import { Label, Input, Textarea, Select, FieldHint } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { POLICY_DECISIONS } from "@/lib/validation/policy";
import type { AgentPermission } from "@prisma/client";
import type { PermissionFormState } from "@/lib/policies/actions";

const initialState: PermissionFormState = {};

export function PermissionForm({
  agentSlug,
  permission,
  action,
}: {
  agentSlug: string;
  permission?: AgentPermission;
  action: (prevState: PermissionFormState, formData: FormData) => Promise<PermissionFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div>
        <Label htmlFor="action">Action</Label>
        <Input
          id="action"
          name="action"
          required
          maxLength={80}
          placeholder="refund.issue"
          defaultValue={permission?.action}
        />
        <FieldHint>
          Lowercase, dot-namespaced, e.g. <code>crm.contact.read</code> or a wildcard like{" "}
          <code>crm.*</code>.
        </FieldHint>
      </div>

      <div>
        <Label htmlFor="resource">Resource</Label>
        <Input
          id="resource"
          name="resource"
          maxLength={80}
          placeholder="Leave blank to apply to any resource"
          defaultValue={permission?.resource}
        />
      </div>

      <div>
        <Label htmlFor="decision">Decision</Label>
        <Select id="decision" name="decision" required defaultValue={permission?.decision ?? "ALLOW"}>
          {POLICY_DECISIONS.map((decision) => (
            <option key={decision} value={decision}>
              {decision.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={300}
          placeholder="Why does this agent need this?"
          defaultValue={permission?.description ?? ""}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : permission ? "Save changes" : "Add permission"}
        </Button>
        <ButtonLink href={`/agents/${agentSlug}?tab=permissions`} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
