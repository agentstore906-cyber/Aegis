"use client";

import { useEffect } from "react";
import { CircleCheck, CircleX, Cpu, Globe, Rocket, Wrench, X } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { DemoRunStatusBadge, DemoStepStatusBadge } from "./badges";
import { useDemo } from "./demo-context";
import { getAgent, getRun } from "./data";
import type { DemoStepKind } from "./types";

const STEP_ICONS: Record<DemoStepKind, typeof Rocket> = {
  start: Rocket,
  tool: Wrench,
  api: Globe,
  model: Cpu,
  end: CircleCheck,
};

export function RunDetailDrawer() {
  const { selectedRunId, closeRun } = useDemo();
  const run = selectedRunId ? getRun(selectedRunId) : undefined;

  useEffect(() => {
    if (!run) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeRun();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [run, closeRun]);

  if (!run) return null;

  const agent = getAgent(run.agentId);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close run details"
        className="focus-ring absolute inset-0 bg-foreground/20"
        onClick={closeRun}
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-border bg-surface shadow-[0_0_40px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Run detail</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{agent?.name}</p>
          </div>
          <button
            type="button"
            onClick={closeRun}
            aria-label="Close"
            className="focus-ring flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex items-center justify-between">
            <DemoRunStatusBadge status={run.status} />
            <span className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
            <SummaryTile label="Duration" value={`${(run.durationMs / 1000).toFixed(1)}s`} />
            <SummaryTile label="Tokens" value={run.totalTokens.toLocaleString()} />
            <SummaryTile label="Cost" value={formatCurrency(run.costCents)} />
          </div>

          <p className="mt-6 mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Timeline
          </p>
          <ol className="relative space-y-5 border-l border-border pl-6">
            {run.steps.map((step) => {
              const Icon = STEP_ICONS[step.kind];
              const failed = step.status === "failed";
              return (
                <li key={step.id} className="relative">
                  <span
                    className={`absolute top-0.5 -left-[29px] flex size-5 items-center justify-center rounded-full border ${
                      failed
                        ? "border-danger-border bg-danger-bg text-danger"
                        : step.status === "pending"
                          ? "border-info-border bg-info-bg text-info"
                          : "border-success-border bg-success-bg text-success"
                    }`}
                  >
                    {failed ? (
                      <CircleX className="size-3" aria-hidden="true" />
                    ) : (
                      <Icon className="size-3" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{step.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                      {(step.tokens || step.costCents) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {step.tokens ? `${step.tokens.toLocaleString()} tokens` : null}
                          {step.tokens && step.costCents ? " · " : null}
                          {step.costCents ? formatCurrency(step.costCents) : null}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <DemoStepStatusBadge status={step.status} />
                      {step.durationMs > 0 && (
                        <span className="text-[11px] text-muted-foreground">{step.durationMs}ms</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
