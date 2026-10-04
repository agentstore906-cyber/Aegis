"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";

import type { PaletteCommand } from "./command-palette";

// The palette is only downloaded the first time it is opened.
const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });

/** Trigger + global Ctrl/⌘K shortcut. Restores focus to the trigger when the palette closes. */
export function PaletteHost({ commands }: { commands: PaletteCommand[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Platform label is client-only, so it is set after mount to keep server and client markup identical.
  const [mac, setMac] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Search or jump to…"
        className="focus-ring flex h-9 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-w-56"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:block">Search or jump to…</span>
        <kbd className="num hidden rounded border border-border px-1.5 py-0.5 text-[10px] sm:block">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && <CommandPalette commands={commands} onClose={close} />}
    </>
  );
}
