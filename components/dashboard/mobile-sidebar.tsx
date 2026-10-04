"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@prisma/client";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { NavList, type NavCounts } from "./nav-list";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile navigation drawer, as a real modal dialog: it names itself, traps Tab,
 * closes on Escape / backdrop / navigation, locks page scroll while open, and
 * returns focus to the button that opened it.
 */
export function MobileSidebar({ role, counts }: { role: MemberRole; counts?: NavCounts }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const lastPath = useRef(pathname);

  const close = useCallback(() => setOpen(false), []);

  // Close when the route changes (covers links and back/forward).
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      const t = setTimeout(close, 0);
      return () => clearTimeout(t);
    }
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open, close]);

  return (
    <div className="lg:hidden">
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="focus-ring flex size-9 items-center justify-center rounded-md border border-border"
      >
        <Menu className="size-4" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="aegis-enter flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-surface"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <Logo />
              <button type="button" onClick={close} aria-label="Close navigation" className="focus-ring flex size-8 items-center justify-center rounded-md border border-border">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <NavList role={role} counts={counts} onNavigate={close} />
            </div>
          </div>
          <div aria-hidden="true" className="flex-1 bg-black/50" onClick={close} />
        </div>
      )}
    </div>
  );
}
