"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@prisma/client";

import { activeHref, navFor, type NavCountKey, type NavItem } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";

export type NavCounts = Partial<Record<NavCountKey, number>>;

function NavLink({ item, active, count, onNavigate }: { item: NavItem; active: boolean; count?: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  const showCount = typeof count === "number" && count > 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-surface-muted text-foreground" : "text-muted-foreground hover:bg-surface-muted/70 hover:text-foreground"
      )}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
      <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {showCount && (
        <span
          className="num ml-auto rounded-full border border-border bg-surface px-1.5 text-[11px] leading-5 text-foreground"
          title={`${count} ${item.countLabel ?? ""}`.trim()}
        >
          <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
          <span className="sr-only">
            , {count} {item.countLabel}
          </span>
        </span>
      )}
    </Link>
  );
}

/** The one navigation list, used by the desktop sidebar and the mobile drawer. */
export function NavList({ role, counts, onNavigate }: { role: MemberRole; counts?: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { groups, utility } = navFor(role);
  const active = activeHref(pathname, [...groups.flatMap((g) => g.items), ...utility]);

  return (
    <nav aria-label="Primary" className="space-y-5">
      {groups.map((group) => (
        <div key={group.id} role="group" aria-labelledby={`nav-${group.id}`}>
          <p id={`nav-${group.id}`} className="section-label mb-1 px-3">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={active === item.href} count={item.count ? counts?.[item.count] : undefined} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      {utility.length > 0 && (
        <div className="space-y-0.5 border-t border-border pt-3">
          {utility.map((item) => (
            <NavLink key={item.href} item={item} active={active === item.href} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </nav>
  );
}
