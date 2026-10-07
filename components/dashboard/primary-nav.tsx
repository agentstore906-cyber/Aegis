"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** The two things Aegis is for. Everything else lives in the menu and the command palette. */
const ITEMS = [
  { label: "Aegis Control", href: "/agents", match: ["/agents", "/overview"] },
  { label: "Free Risk Scanner", href: "/risk-scan", match: ["/risk-scan"] },
] as const;

export function PrimaryNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("flex items-center gap-1", className)}>
      {ITEMS.map((item) => {
        const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring relative inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
            {active && <span aria-hidden="true" className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}
