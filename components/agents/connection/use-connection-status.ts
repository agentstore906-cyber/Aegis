"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The JSON shape of GET /api/agents/:slug/connection (dates arrive as ISO strings). */
export type ConnectionSnapshotJson = {
  agent: { id: string; slug: string; name: string; environment: string };
  hasConnectionRecord: boolean;
  connectorType: string | null;
  view: {
    state: "WAITING" | "CREDENTIAL_VERIFIED" | "CONNECTED" | "NOT_SEEN_RECENTLY" | "ERROR" | "REVOKED";
    stateLabel: string;
    detail: string;
    reason: string | null;
    monitoring: "NONE" | "RECEIVING" | "QUIET";
    monitoringLabel: string;
    protection: "MONITORING_ONLY" | "ASKS_FOR_DECISIONS";
    protectionLabel: string;
    protectionDetail: string;
    steps: { key: "identity" | "connection" | "activity"; label: string; done: boolean; at: string | null }[];
    firstHandshakeAt: string | null;
    lastSeenAt: string | null;
    reportedEventCount: number;
  };
  baseline: { maturity: string; eventsObserved: number; version: number } | null;
  eventsObserved: number;
};

export type StatusProblem = "signed-out" | "not-found" | "unavailable" | "unreachable";

/**
 * Polls the backend for the connection state. It never infers anything: `snapshot` is whatever the server last
 * said, `problem` says why we could not ask, and `checkedAt` is when a check last SUCCEEDED. Nothing is polled while
 * the tab is hidden, and polling stops once `stopWhen` is satisfied.
 */
export function useConnectionStatus(slug: string | null, options: { intervalMs?: number; stopWhen?: (s: ConnectionSnapshotJson) => boolean } = {}) {
  const { intervalMs = 3000, stopWhen } = options;
  const [snapshot, setSnapshot] = useState<ConnectionSnapshotJson | null>(null);
  const [problem, setProblem] = useState<StatusProblem | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const stopRef = useRef(stopWhen);
  const doneRef = useRef(false);
  useEffect(() => {
    stopRef.current = stopWhen;
  });

  const check = useCallback(
    async (signal?: AbortSignal) => {
      if (!slug) return;
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(slug)}/connection`, { cache: "no-store", signal });
        if (response.status === 401) return setProblem("signed-out");
        if (response.status === 404) return setProblem("not-found");
        if (!response.ok) return setProblem("unavailable");
        const body = (await response.json()) as ConnectionSnapshotJson;
        setSnapshot(body);
        setProblem(null);
        setCheckedAt(new Date());
        if (stopRef.current?.(body)) doneRef.current = true;
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProblem("unreachable");
      }
    },
    [slug]
  );

  useEffect(() => {
    if (!slug) return;
    doneRef.current = false;
    const controller = new AbortController();
    // First check on the next tick (a state update must not run synchronously inside the effect body).
    const first = setTimeout(() => void check(controller.signal), 0);
    const timer = setInterval(() => {
      if (doneRef.current || document.visibilityState !== "visible") return;
      void check(controller.signal);
    }, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && !doneRef.current && void check(controller.signal);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, intervalMs, check]);

  return { snapshot, problem, checkedAt, recheck: () => check() };
}
