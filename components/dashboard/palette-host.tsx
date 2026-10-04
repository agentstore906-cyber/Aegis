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
        title={`Search (${mac ? "⌘K" : "Ctrl K"})`}
        className="focus-ring flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <Search className="size-[18px]" aria-hidden="true" />
      </button>
      {open && <CommandPalette commands={commands} onClose={close} />}
    </>
  );
}
