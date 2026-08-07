import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "tools", label: "Tools" },
  { id: "permissions", label: "Permissions" },
  { id: "costs", label: "Costs" },
  { id: "policies", label: "Policies" },
] as const;

export function AgentTabs({ slug, active }: { slug: string; active: string }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const href = tab.id === "overview" ? `/agents/${slug}` : `/agents/${slug}?tab=${tab.id}`;
        return (
          <Link
            key={tab.id}
            href={href}
            className={cn(
              "focus-ring shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
