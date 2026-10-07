import type { MemberRole } from "@prisma/client";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { NavDrawer } from "@/components/dashboard/nav-drawer";
import type { NavCounts } from "@/components/dashboard/nav-list";
import { PaletteHost } from "@/components/dashboard/palette-host";
import { PrimaryNav } from "@/components/dashboard/primary-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { canViewBilling } from "@/lib/billing/authorization";
import { paletteCommands } from "@/lib/dashboard-commands";

/**
 * The whole top bar: the Aegis menu (every destination, hidden until asked for), the two primary destinations
 * (Aegis Control, Free Risk Scanner), Upgrade, search and the account. On a phone the primary destinations drop to their own
 * row so Upgrade and the account never get pushed off screen.
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
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <NavDrawer role={role} counts={counts} />
          <span aria-hidden="true" className="hidden h-4 w-px bg-border md:block" />
          <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:inline" title="Current workspace">
            {organizationName}
          </span>
          <PrimaryNav className="ml-2 hidden sm:flex" />
        </div>

        <div className="flex items-center gap-1">
          {canViewBilling(role) && (
            <Link href="/upgrade" className="aegis-upgrade aegis-upgrade--compact focus-ring mr-1">
              <Sparkles aria-hidden="true" className="size-3.5 text-accent" />
              Upgrade
            </Link>
          )}
          <PaletteHost commands={paletteCommands(role)} />
          <UserMenu name={userName} email={userEmail} />
        </div>
      </div>
      <PrimaryNav className="px-3 sm:hidden" />
    </header>
  );
}
