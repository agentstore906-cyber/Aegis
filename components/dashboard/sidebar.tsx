import Link from "next/link";
import type { MemberRole } from "@prisma/client";

import { Logo } from "@/components/ui/logo";
import { NavList, type NavCounts } from "./nav-list";

export function Sidebar({ role, counts }: { role: MemberRole; counts?: NavCounts }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <Link href="/overview" className="focus-ring rounded-sm" aria-label="Aegis, Command center">
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavList role={role} counts={counts} />
      </div>
    </aside>
  );
}
