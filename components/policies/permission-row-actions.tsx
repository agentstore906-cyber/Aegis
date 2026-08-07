"use client";

import { Pencil, Trash2 } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteAgentPermissionAction } from "@/lib/policies/actions";

export function PermissionRowActions({
  agentSlug,
  permissionId,
  action,
}: {
  agentSlug: string;
  permissionId: string;
  action: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <ButtonLink
        href={`/agents/${agentSlug}/permissions/${permissionId}/edit`}
        variant="ghost"
        size="sm"
        aria-label={`Edit ${action}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </ButtonLink>
      <ConfirmDialog
        title="Delete permission"
        description={`Remove the "${action}" permission? This agent will fall back to the default (blocked) for this action.`}
        confirmLabel="Delete"
        onConfirm={() => deleteAgentPermissionAction(agentSlug, permissionId)}
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Delete ${action}`} type="button">
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        }
      />
    </div>
  );
}
