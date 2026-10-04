import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A truthful error: what failed, what that means for the data on screen, and what to do.
 * It never hides a failure behind a successful-looking layout, and it says plainly whether
 * anything was changed.
 */
export function ErrorState({
  title,
  what,
  dataNote,
  action,
  reference,
  className,
}: {
  title: string;
  /** What failed, in plain words. */
  what: string;
  /** Whether the data on this screen is missing or may be stale. */
  dataNote: string;
  action?: React.ReactNode;
  /** An error reference (for example a digest) to quote to support. */
  reference?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-danger-border bg-danger-bg px-6 py-12 text-center", className)}>
      <div className="flex size-10 items-center justify-center rounded-full border border-danger-border">
        <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{what}</p>
        <p className="max-w-md text-sm text-muted-foreground">{dataNote}</p>
        {reference && <p className="num font-mono text-xs text-muted-foreground">Reference {reference}</p>}
      </div>
      {action}
    </div>
  );
}
