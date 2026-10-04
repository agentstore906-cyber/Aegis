import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An empty state is part of the product, not an apology. It states three things:
 *   WHAT is empty          `title`
 *   WHY it is empty        `description`
 *   WHAT TO DO NEXT        `hint` and/or `action`
 * It never shows sample content, and never implies something is happening that is not.
 * `compact` renders inline inside a panel (no dashed box); the default is a standalone block.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  eyebrow,
  action,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What the user can do next, when it is not obvious from `action`. */
  hint?: string;
  /** A small upper-case region name above the title. */
  eyebrow?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "px-4 py-8" : "rounded-xl border border-border bg-surface-muted/50 px-6 py-16"
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-surface-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        {eyebrow && <p className="section-label">{eyebrow}</p>}
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
