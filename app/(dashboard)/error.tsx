"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Dashboard-wide error boundary — catches failures on any authenticated
 * page that doesn't have its own more specific error.tsx (e.g. a database
 * outage on /overview, /policies, /costs). Keeps the user inside the app
 * shell instead of falling through to the global boundary.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ msg: "dashboard_error", digest: error.digest, error: String(error) })
    );
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-bg">
        <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Couldn&apos;t load this page</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Something went wrong on our end. Try again in a moment.
        </p>
      </div>
      <Button onClick={reset} size="sm">
        Try again
      </Button>
    </div>
  );
}
