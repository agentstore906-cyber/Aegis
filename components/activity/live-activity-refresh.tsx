"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Near-real-time activity monitoring, the simplest version that fits this
 * app's architecture: server components + server actions, no queue or
 * websocket infrastructure. Same router.refresh()-on-an-interval pattern
 * already used by AgentConnectPanel (components/agents/agent-connect-panel.tsx)
 * — re-running the server component for the current URL picks up new
 * ActivityEvent/SecurityAlert rows (and respects whatever filters are in
 * the URL) without a full page reload or any client-side state to manage.
 *
 * Renders nothing — mount it once per page that should stay live.
 */
export function LiveActivityRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}
