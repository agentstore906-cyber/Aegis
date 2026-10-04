"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Dashboard-wide error boundary — catches failures on any authenticated page that doesn't have its own
 * more specific error.tsx (for example a database outage). Keeps the user inside the app shell, and says
 * truthfully what happened: the page could not be built, so nothing on it is current, and the failure
 * itself changed no data.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ msg: "dashboard_error", digest: error.digest, error: String(error) }));
  }, [error]);

  return (
    <ErrorState
      title="This view could not be loaded"
      what="Aegis could not finish building this page. The request failed on the server."
      dataNote="Nothing here is current, and nothing was changed by this error. Records already stored are unaffected."
      reference={error.digest}
      action={
        <Button onClick={reset} size="sm">
          Try again
        </Button>
      }
    />
  );
}
