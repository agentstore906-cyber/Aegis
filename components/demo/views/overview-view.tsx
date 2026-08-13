import { AlertTriangle, Bot, DollarSign, Zap } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { OVERVIEW_STATS, DEMO_ACTIVITY, getAgent } from "../data";
import { DemoAgentStatusBadge, DemoAlertSeverityBadge } from "../badges";
import { useDemo } from "../demo-context";

export function OverviewView() {
  const { agents, alerts, navigate, openAgent, openRun } = useDemo();
  const openAlerts = alerts.filter((alert) => alert.status === "open");
  const topAgents = agents.slice(0, 5);
  const recentActivity = DEMO_ACTIVITY.slice(0, 6);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This is an interactive product demo. All agents, runs, and alerts shown here are
          sample data — nothing is connected to a real production account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Agents" value={String(OVERVIEW_STATS.agents)} icon={Bot} />
        <StatCard label="Runs" value={OVERVIEW_STATS.runs.toLocaleString()} icon={Zap} />
        <StatCard label="Cost" value={formatCurrency(OVERVIEW_STATS.costCents)} icon={DollarSign} />
        <StatCard
          label="Alerts"
          value={String(OVERVIEW_STATS.alerts)}
          icon={AlertTriangle}
          tone={openAlerts.length > 0 ? "warning" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Agents</h2>
            <button
              type="button"
              onClick={() => navigate("agents")}
              className="focus-ring rounded-sm text-xs font-medium text-brand hover:underline"
            >
              View all
            </button>
          </div>
          <ul className="divide-y divide-border">
            {topAgents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => openAgent(agent.id)}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{agent.runs.toLocaleString()} runs</p>
                  </div>
                  <DemoAgentStatusBadge status={agent.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Alerts needing attention</h2>
            <button
              type="button"
              onClick={() => navigate("alerts")}
              className="focus-ring rounded-sm text-xs font-medium text-brand hover:underline"
            >
              View all
            </button>
          </div>
          {openAlerts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No open alerts. All clear.</p>
          ) : (
            <ul className="divide-y divide-border">
              {openAlerts.map((alert) => {
                const agent = getAgent(alert.agentId);
                return (
                  <li key={alert.id}>
                    <button
                      type="button"
                      onClick={() => navigate("alerts")}
                      className="focus-ring flex w-full items-start justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-muted"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{alert.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{agent?.name}</p>
                      </div>
                      <DemoAlertSeverityBadge severity={alert.severity} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
          <button
            type="button"
            onClick={() => navigate("activity")}
            className="focus-ring rounded-sm text-xs font-medium text-brand hover:underline"
          >
            View all
          </button>
        </div>
        <ul className="divide-y divide-border">
          {recentActivity.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openRun(item.runId)}
                className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-muted"
              >
                <span className="min-w-0 truncate text-sm text-foreground">{item.summary}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
