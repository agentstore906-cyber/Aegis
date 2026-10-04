import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** The sections an operator reaches for first. Every id is a real tab of the agent page. */
const PRIMARY = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "behavior", label: "Behavior" },
  { id: "trust", label: "Trust" },
  { id: "policies", label: "Policies" },
  { id: "tools", label: "Tools" },
  { id: "security", label: "Security" },
] as const;

/** Everything else stays one click away, not gone. */
const MORE = [
  { id: "permissions", label: "Permissions" },
  { id: "approvals", label: "Approvals" },
  { id: "graph", label: "Action graph" },
  { id: "control", label: "Control" },
  { id: "costs", label: "Costs" },
] as const;

const hrefFor = (slug: string, id: string) => (id === "overview" ? `/agents/${slug}` : `/agents/${slug}?tab=${id}`);

export function AgentTabs({ slug, active }: { slug: string; active: string }) {
  const moreActive = MORE.some((t) => t.id === active);
  return (
    <nav aria-label="Agent sections" className="mb-8 flex items-center gap-1 overflow-x-auto border-b border-border">
      {PRIMARY.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={hrefFor(slug, tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-ring -mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              isActive ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      <details className="group relative shrink-0" open={moreActive || undefined}>
        <summary
          className={cn(
            "focus-ring -mb-px flex cursor-pointer list-none items-center gap-1 border-b-2 px-3 py-2.5 text-sm transition-colors [&::-webkit-details-marker]:hidden",
            moreActive ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {moreActive ? (MORE.find((t) => t.id === active)?.label ?? "More") : "More"}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-pop)]">
          {MORE.map((tab) => (
            <Link
              key={tab.id}
              href={hrefFor(slug, tab.id)}
              aria-current={tab.id === active ? "page" : undefined}
              className={cn("focus-ring block rounded-lg px-3 py-1.5 text-sm hover:bg-surface-muted", tab.id === active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
