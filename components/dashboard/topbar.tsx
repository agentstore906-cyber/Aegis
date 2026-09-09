import Link from "next/link";
import type { MemberRole } from "@prisma/client";
import { Sparkles } from "lucide-react";

import { MobileSidebar } from "@/components/dashboard/mobile-sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { canViewBilling, canManageBilling } from "@/lib/billing/authorization";
import { DEFAULT_PLAN_ID } from "@/lib/billing/plans";

export function Topbar({
  organizationName,
  plan,
  role,
  userName,
  userEmail,
}: {
  organizationName: string;
  plan: string;
  role: MemberRole;
  userName: string;
  userEmail: string;
}) {
  const viewBilling = canViewBilling(role);
  const showUpgrade = canManageBilling(role) && plan === DEFAULT_PLAN_ID;

  const planBadge = (
    <Badge tone="neutral" className="shrink-0 capitalize">
      {plan}
    </Badge>
  );

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <MobileSidebar role={role} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{organizationName}</span>
          {viewBilling ? (
            <Link
              href="/settings/billing"
              className="focus-ring shrink-0 rounded-md"
              aria-label={`Current plan: ${plan}. Open billing`}
            >
              {planBadge}
            </Link>
          ) : (
            planBadge
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {showUpgrade && (
          <ButtonLink href="/settings/billing" size="sm">
            <Sparkles className="size-4" aria-hidden="true" />
            Upgrade
          </ButtonLink>
        )}
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
