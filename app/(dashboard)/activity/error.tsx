"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ActivityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-bg">
        <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Couldn&apos;t load activity</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something went wrong while loading this page. Try again.
        </p>
      </div>
      <Button onClick={reset} size="sm">
        Try again
      </Button>
    </div>
  );
}
