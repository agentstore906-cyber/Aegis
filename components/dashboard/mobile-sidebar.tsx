"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { NAV_ITEMS } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="focus-ring flex size-9 items-center justify-center rounded-md border border-border"
      >
        <Menu className="size-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex h-full w-64 flex-col border-r border-border bg-surface p-4">
            <div className="mb-6 flex shrink-0 items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="focus-ring flex size-8 items-center justify-center rounded-md border border-border"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Dashboard">
              {NAV_ITEMS.filter((item) => item.status === "active").map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                      isActive ? "bg-surface-muted text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            className="focus-ring flex-1 bg-foreground/20"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
