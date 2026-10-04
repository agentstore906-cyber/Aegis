"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@prisma/client";
import { ChevronRight } from "lucide-react";

import { activeHref, navFor, type NavCountKey, type NavItem } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";

export type NavCounts = Partial<Record<NavCountKey, number>>;

function NavLink({ item, active, count, onNavigate, icon = true }: { item: NavItem; active: boolean; count?: number; onNavigate?: () => void; icon?: boolean }) {
  const Icon = item.icon;
  const showCount = typeof count === "number" && count > 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-surface-muted font-medium text-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      )}
    >
      {icon && <Icon className={cn("size-[18px] shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} aria-hidden="true" />}
      <span className={cn("truncate", !icon && "pl-0.5")}>{item.label}</span>
      {showCount && (
        <span
          className="num ml-auto rounded-full bg-foreground px-1.5 text-[11px] font-medium leading-5 text-background"
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
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className="space-y-4">
        {groups.map((group) => {
          const holdsActive = group.items.some((i) => i.href === active);
          const open = !group.collapsible || moreOpen || holdsActive;
          // A count inside a collapsed group stays visible on its header, so an open alert is never hidden.
          const hiddenCount = group.collapsible && !open ? group.items.reduce((n, i) => n + (i.count ? (counts?.[i.count] ?? 0) : 0), 0) : 0;
          return (
            <div key={group.id}>
              {group.collapsible && (
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={open}
                  aria-controls={`nav-${group.id}`}
                  disabled={holdsActive}
                  className="focus-ring mb-1 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
                  {group.label}
                  {hiddenCount > 0 && <span className="num ml-auto rounded-full bg-foreground px-1.5 text-[11px] leading-5 text-background">{hiddenCount > 99 ? "99+" : hiddenCount}</span>}
                </button>
              )}
              {open && (
                <div id={`nav-${group.id}`} className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={active === item.href} count={item.count ? counts?.[item.count] : undefined} onNavigate={onNavigate} icon={!group.collapsible} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {utility.length > 0 && (
        <div className="mt-auto space-y-0.5 pt-6">
          {utility.map((item) => (
            <NavLink key={item.href} item={item} active={active === item.href} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </nav>
  );
}
