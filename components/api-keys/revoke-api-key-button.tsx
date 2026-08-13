"use client";

import { Ban } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { revokeApiKeyAction } from "@/lib/api-keys/actions";

export function RevokeApiKeyButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm">
          <Ban className="size-3.5" aria-hidden="true" />
          Revoke
        </Button>
      }
      title="Revoke this API key?"
      description={`"${name}" will stop authenticating immediately. Any agent still using it will start getting 401 errors. This can't be undone.`}
      confirmLabel="Revoke key"
      onConfirm={() => revokeApiKeyAction(id)}
    />
  );
}
