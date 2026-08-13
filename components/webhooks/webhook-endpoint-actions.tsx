"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setWebhookEndpointStatusAction, deleteWebhookEndpointAction } from "@/lib/webhooks/actions";
import type { WebhookEndpointStatus } from "@prisma/client";

export function WebhookEndpointActions({ id, status }: { id: string; status: WebhookEndpointStatus }) {
  const [isPending, startTransition] = useTransition();
  const nextStatus = status === "ACTIVE" ? "DISABLED" : "ACTIVE";

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() => startTransition(() => setWebhookEndpointStatusAction(id, nextStatus))}
      >
        {status === "ACTIVE" ? "Disable" : "Enable"}
      </Button>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="ghost" size="sm">
            Delete
          </Button>
        }
        title="Delete this webhook endpoint?"
        description="Aegis will stop sending events to this URL immediately. This can't be undone."
        confirmLabel="Delete endpoint"
        onConfirm={() => deleteWebhookEndpointAction(id)}
      />
    </div>
  );
}
