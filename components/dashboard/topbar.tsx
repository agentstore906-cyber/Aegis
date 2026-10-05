import type { MemberRole } from "@prisma/client";
import Link from "next/link";

import { NavDrawer } from "@/components/dashboard/nav-drawer";
import type { NavCounts } from "@/components/dashboard/nav-list";
import { PaletteHost } from "@/components/dashboard/palette-host";
import { UserMenu } from "@/components/dashboard/user-menu";
import { canViewBilling } from "@/lib/billing/authorization";
import { paletteCommands } from "@/lib/dashboard-commands";

/**
 * The whole top bar: the Aegis menu (every destination, hidden until asked for), the current workspace, search,
 * and the account. There is no permanent navigation anywhere else.
 */
export function Topbar({
  organizationName,
  role,
  userName,
  userEmail,
  counts,
}: {
  organizationName: string;
  role: MemberRole;
  userName: string;
  userEmail: string;
  counts?: NavCounts;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <NavDrawer role={role} counts={counts} />
        <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
        <span className="hidden truncate text-sm text-muted-foreground sm:inline" title="Current workspace">
          {organizationName}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {canViewBilling(role) && (
          <Link
            href="/upgrade"
            className="focus-ring mr-1 inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Upgrade
          </Link>
        )}
        <PaletteHost commands={paletteCommands(role)} />
        <UserMenu name={userName} email={userEmail} />
      </div>
    </header>
  );
}
