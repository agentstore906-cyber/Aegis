"use client";

import { useTransition } from "react";
import { Pencil, Trash2, Power } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deletePolicyAction, setPolicyStatusAction } from "@/lib/policies/actions";
import type { PolicyStatus } from "@prisma/client";

export function PolicyRowActions({
  policyId,
  name,
  status,
}: {
  policyId: string;
  name: string;
  status: PolicyStatus;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={isPending}
        aria-label={status === "ACTIVE" ? `Disable ${name}` : `Enable ${name}`}
        title={status === "ACTIVE" ? "Disable" : "Enable"}
        onClick={() =>
          startTransition(() => {
            setPolicyStatusAction(policyId, status === "ACTIVE" ? "DISABLED" : "ACTIVE");
          })
        }
      >
        <Power className="size-3.5" aria-hidden="true" />
      </Button>
      <ButtonLink href={`/policies/${policyId}/edit`} variant="ghost" size="sm" aria-label={`Edit ${name}`}>
        <Pencil className="size-3.5" aria-hidden="true" />
      </ButtonLink>
      <ConfirmDialog
        title="Delete policy"
        description={`Delete "${name}"? Past evaluations that referenced this policy keep a snapshot and remain unaffected.`}
        confirmLabel="Delete"
        onConfirm={() => deletePolicyAction(policyId)}
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Delete ${name}`} type="button">
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        }
      />
    </div>
  );
}
