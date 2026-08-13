"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "@/lib/organizations/actions";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { OrganizationInvitation } from "@prisma/client";

export function PendingInvitationsList({ invitations }: { invitations: OrganizationInvitation[] }) {
  const [isPending, startTransition] = useTransition();

  if (invitations.length === 0) return null;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{invitation.email}</p>
            <p className="text-xs text-muted-foreground">
              {invitation.role.toLowerCase()} · expires {formatRelativeTime(invitation.expiresAt)} ·{" "}
              {formatDateTime(invitation.createdAt)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => startTransition(() => revokeInvitationAction(invitation.id))}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
