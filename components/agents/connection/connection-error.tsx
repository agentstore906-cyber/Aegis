import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A connection failure that says what actually happened. `reasons` lists only causes the backend could determine —
 * pass nothing and none are listed; this never guesses. `onRetry` and `onViewSetup` are shown only when given.
 */
export function ConnectionError({
  title = "Connection failed",
  message,
  reasons,
  onRetry,
  onViewSetup,
}: {
  title?: string;
  message: string;
  reasons?: string[];
  onRetry?: () => void;
  onViewSetup?: () => void;
}) {
  return (
    <div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-4">
      <p className="flex items-center gap-2 text-sm font-medium text-danger">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1.5 text-sm text-foreground">{message}</p>
      {reasons && reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {(onRetry || onViewSetup) && (
        <div className="mt-3 flex gap-2">
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
          {onViewSetup && (
            <Button size="sm" variant="ghost" onClick={onViewSetup}>
              View setup
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
