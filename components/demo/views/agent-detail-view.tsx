import { ArrowLeft } from "lucide-react";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { getAgent, getRunsForAgent } from "../data";
import { DemoAgentStatusBadge, DemoRunStatusBadge } from "../badges";
import { PauseAgentButton } from "../pause-agent-button";
import { useDemo } from "../demo-context";

export function AgentDetailView() {
  const { selectedAgentId, navigate, openRun } = useDemo();
  const agent = selectedAgentId ? getAgent(selectedAgentId) : undefined;

  if (!agent) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Agent not found.</p>
        <button
          type="button"
          onClick={() => navigate("agents")}
          className="focus-ring mt-2 text-sm font-medium text-brand hover:underline"
        >
          Back to agents
        </button>
      </div>
    );
  }

  const runs = getRunsForAgent(agent.id);

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate("agents")}
        className="focus-ring mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to agents
      </button>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-foreground">{agent.name}</h1>
            <DemoAgentStatusBadge status={agent.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{agent.role}</p>
        </div>
        <PauseAgentButton agentId={agent.id} status={agent.status} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Model" value={agent.model} />
        <Field label="Runs" value={agent.runs.toLocaleString()} />
        <Field label="Cost" value={formatCurrency(agent.costCents)} />
        <Field label="Success rate" value={`${agent.successRate.toFixed(1)}%`} />
        <Field label="Avg latency" value={`${(agent.avgLatencyMs / 1000).toFixed(1)}s`} />
        <Field label="Token usage" value={agent.tokenUsage.toLocaleString()} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Recent runs</h2>
        </div>
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => openRun(run.id)}
                className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {run.steps[run.steps.length - 1].detail}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatRelativeTime(run.startedAt)} · {(run.durationMs / 1000).toFixed(1)}s ·{" "}
                    {formatCurrency(run.costCents)}
                  </p>
                </div>
                <DemoRunStatusBadge status={run.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
