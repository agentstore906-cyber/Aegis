"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEMO_AGENTS, DEMO_ALERTS } from "./data";
import type { DemoAgent, DemoAlert } from "./types";

export type DemoView = "overview" | "agents" | "agent-detail" | "activity" | "alerts";

interface DemoContextValue {
  agents: DemoAgent[];
  alerts: DemoAlert[];
  view: DemoView;
  selectedAgentId: string | null;
  selectedRunId: string | null;
  navigate: (view: DemoView) => void;
  openAgent: (agentId: string) => void;
  openRun: (runId: string) => void;
  closeRun: () => void;
  pauseAgent: (agentId: string) => void;
  resumeAgent: (agentId: string) => void;
  resolveAlert: (alertId: string) => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<DemoAgent[]>(DEMO_AGENTS);
  const [alerts, setAlerts] = useState<DemoAlert[]>(DEMO_ALERTS);
  const [view, setView] = useState<DemoView>("overview");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const navigate = useCallback((next: DemoView) => {
    setView(next);
    if (next !== "agent-detail") setSelectedAgentId(null);
  }, []);

  const openAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setView("agent-detail");
  }, []);

  const openRun = useCallback((runId: string) => setSelectedRunId(runId), []);
  const closeRun = useCallback(() => setSelectedRunId(null), []);

  const setAgentStatus = useCallback((agentId: string, status: DemoAgent["status"]) => {
    setAgents((prev) => prev.map((agent) => (agent.id === agentId ? { ...agent, status } : agent)));
  }, []);

  const pauseAgent = useCallback(
    (agentId: string) => {
      setAgentStatus(agentId, "paused");
      setAlerts((prev) =>
        prev.map((alert) =>
          alert.agentId === agentId && alert.status === "open" ? { ...alert, status: "resolved" } : alert
        )
      );
    },
    [setAgentStatus]
  );

  const resumeAgent = useCallback((agentId: string) => setAgentStatus(agentId, "active"), [setAgentStatus]);

  const resolveAlert = useCallback((alertId: string) => {
    setAlerts((prev) =>
      prev.map((alert) => (alert.id === alertId ? { ...alert, status: "resolved" } : alert))
    );
  }, []);

  const value = useMemo<DemoContextValue>(
    () => ({
      agents,
      alerts,
      view,
      selectedAgentId,
      selectedRunId,
      navigate,
      openAgent,
      openRun,
      closeRun,
      pauseAgent,
      resumeAgent,
      resolveAlert,
    }),
    [agents, alerts, view, selectedAgentId, selectedRunId, navigate, openAgent, openRun, closeRun, pauseAgent, resumeAgent, resolveAlert]
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within a DemoProvider");
  return ctx;
}
