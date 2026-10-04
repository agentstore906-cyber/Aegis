"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

import type { SearchGroup } from "@/lib/search/service";
import { cn } from "@/lib/utils";

export type PaletteCommand = { id: string; label: string; href: string; group: string; keywords?: string };

type Entry = { key: string; label: string; hint: string; href: string; group: string };
type SearchState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; groups: SearchGroup[] };

const MIN = 2;

/**
 * The command palette: jump to any destination you may open, or search real
 * entities (agents, policies, approvals, incidents, alerts, activity, audit).
 * Commands are only real routes the role can reach; search results come from
 * /api/search (organization-scoped on the server). Nothing here is illustrative.
 */
export default function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });

  const q = query.trim();
  const searchable = q.length >= MIN;

  // Debounced, cancellable search. Stale responses are aborted, never shown.
  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearch({ status: "loading" });
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) return setSearch({ status: "error", message: "Your session has ended. Sign in again to search." });
        if (!response.ok) return setSearch({ status: "error", message: "Search is unavailable right now. Navigation still works." });
        const body = (await response.json()) as { groups: SearchGroup[] };
        setSearch({ status: "done", groups: body.groups });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setSearch({ status: "error", message: "Search could not be reached. Check your connection." });
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, searchable]);

  const matchedCommands = useMemo(() => {
    const needle = q.toLowerCase();
    return commands.filter((c) => !needle || `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [commands, q]);

  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = matchedCommands.map((c) => ({ key: `c:${c.id}`, label: c.label, hint: "", href: c.href, group: c.group }));
    if (searchable && search.status === "done") {
      for (const g of search.groups) for (const r of g.results) out.push({ key: `r:${r.type}:${r.id}`, label: r.title, hint: r.subtitle, href: r.href, group: g.label });
    }
    return out;
  }, [matchedCommands, searchable, search]);

  const activeIndex = Math.min(active, Math.max(entries.length - 1, 0));
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  // Keep the highlighted option in view.
  useEffect(() => {
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId]);

  useEffect(() => inputRef.current?.focus(), []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(entries.length ? (activeIndex + 1) % entries.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(entries.length ? (activeIndex - 1 + entries.length) % entries.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(entries[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault(); // focus stays in the palette: the input is the only stop
    }
  };

  const statusText =
    searchable && search.status === "loading"
      ? "Searching…"
      : searchable && search.status === "error"
        ? search.message
        : searchable && search.status === "done" && search.groups.length === 0
          ? `No agents, policies, approvals, incidents, alerts, activity or audit records match "${q}".`
          : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="aegis-enter relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (e.target.value.trim().length < MIN) setSearch({ status: "idle" });
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries.length ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-label="Search Aegis or jump to a page"
            placeholder="Search agents, policies, incidents… or jump to a page"
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="num hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">Esc</kbd>
        </div>

        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-1.5">
          {entries.map((entry, i) => {
            const header = i === 0 || entries[i - 1].group !== entry.group;
            return (
              <li key={entry.key} role="presentation">
                {header && <p className="section-label px-2.5 pb-1 pt-2.5">{entry.group}</p>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(entry)}
                  className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm", i === activeIndex ? "bg-surface-muted text-foreground" : "text-muted-foreground")}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{entry.label}</span>
                    {entry.hint && <span className="block truncate text-xs text-muted-foreground">{entry.hint}</span>}
                  </span>
                  {i === activeIndex && <CornerDownLeft className="size-3.5 shrink-0" aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>

        <p role="status" aria-live="polite" className={cn("border-t border-border px-4 py-2 text-xs", statusText ? "text-muted-foreground" : "sr-only")}>
          {statusText || (entries.length ? `${entries.length} results` : "No matches")}
        </p>
        {!searchable && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Type {MIN}+ characters to also search your agents, policies, approvals, incidents, alerts, activity and audit records.
          </p>
        )}
      </div>
    </div>
  );
}
