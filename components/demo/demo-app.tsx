"use client";

import { DemoProvider, useDemo } from "./demo-context";
import { DemoShell } from "./demo-shell";
import { RunDetailDrawer } from "./run-detail-drawer";
import { OverviewView } from "./views/overview-view";
import { AgentsView } from "./views/agents-view";
import { AgentDetailView } from "./views/agent-detail-view";
import { ActivityView } from "./views/activity-view";
import { AlertsView } from "./views/alerts-view";

function DemoRoot() {
  const { view } = useDemo();

  return (
    <DemoShell>
      {view === "overview" && <OverviewView />}
      {view === "agents" && <AgentsView />}
      {view === "agent-detail" && <AgentDetailView />}
      {view === "activity" && <ActivityView />}
      {view === "alerts" && <AlertsView />}
      <RunDetailDrawer />
    </DemoShell>
  );
}

export function DemoApp() {
  return (
    <DemoProvider>
      <DemoRoot />
    </DemoProvider>
  );
}
