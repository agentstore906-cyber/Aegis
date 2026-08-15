"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { revokeInvitationAction, resendInvitationAction } from "@/lib/organizations/actions";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";
import type { OrganizationInvitation } from "@prisma/client";

export function PendingInvitationsList({ invitations, origin }: { invitations: OrganizationInvitation[]; origin: string }) {
  const [isPending, startTransition] = useTransition();
  const [resentUrl, setResentUrl] = useState<{ id: string; url: string } | null>(null);

  if (invitations.length === 0) return null;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                {invitation.role.toLowerCase()} · expires {formatRelativeTime(invitation.expiresAt)} ·{" "}
                {formatDateTime(invitation.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await resendInvitationAction(invitation.id);
                    setResentUrl(result.inviteUrl ? { id: invitation.id, url: `${origin}${result.inviteUrl}` } : null);
                  })
                }
              >
                Resend
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => startTransition(() => revokeInvitationAction(invitation.id))}
              >
                Revoke
              </Button>
            </div>
          </div>
          {resentUrl?.id === invitation.id && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-bg p-2">
              <code className="min-w-0 flex-1 overflow-x-auto text-xs text-foreground">{resentUrl.url}</code>
              <CopyButton value={resentUrl.url} label="Copy link" />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
