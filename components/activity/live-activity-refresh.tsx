"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a page current — and says exactly how.
 *
 * The architecture is server components plus a periodic server re-render
 * (`router.refresh()`): there is NO websocket and no event stream. So this is
 * AUTO-REFRESH, and the interface never calls it "live". What it shows is only
 * what it really knows:
 *   - the time the last refresh actually COMPLETED (the transition settling),
 *   - that it refreshes every N seconds,
 *   - "Offline" when the browser reports no connection (then it stops asking),
 *   - nothing is polled while the tab is hidden (no wasted server work), and it
 *     refreshes immediately when the tab becomes visible again.
 */
export function LiveActivityRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const wasPending = useRef(false);

  // The page was just rendered by the server: that is a real "updated" moment.
  // (Set from a timer callback, not synchronously in the effect: the value is client time and must not exist during SSR.)
  useEffect(() => {
    const t = setTimeout(() => {
      setUpdatedAt(new Date());
      setOnline(navigator.onLine);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // A refresh has COMPLETED when the transition goes from pending back to idle.
  useEffect(() => {
    if (wasPending.current && !pending) setUpdatedAt(new Date());
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      startTransition(() => router.refresh());
    };
    const interval = setInterval(refresh, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const goOnline = () => {
      setOnline(true);
      refresh();
    };
    const goOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [router, intervalMs]);

  if (!updatedAt) return null;
  const time = updatedAt.toLocaleTimeString([], { hour12: false });

  return (
    <p
      role="status"
      aria-live="off"
      className="num fixed bottom-3 right-3 z-30 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm"
    >
      {online ? (
        <>
          Auto-refresh every {Math.round(intervalMs / 1000)} s · updated {time}
        </>
      ) : (
        <span className="text-warning">Offline · last updated {time}</span>
      )}
    </p>
  );
}
