"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { DEMO_ACTIVITY } from "../data";
import { DemoRunStatusBadge } from "../badges";
import { useDemo } from "../demo-context";
import type { DemoRunStatus } from "../types";

const FILTERS: { key: "all" | DemoRunStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "success", label: "Success" },
  { key: "failed", label: "Failed" },
  { key: "running", label: "Running" },
];

export function ActivityView() {
  const { openRun } = useDemo();
  const [filter, setFilter] = useState<"all" | DemoRunStatus>("all");

  const items = filter === "all" ? DEMO_ACTIVITY : DEMO_ACTIVITY.filter((item) => item.status === filter);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recent runs across every agent.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              "focus-ring rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === item.key
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={filter === item.key}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No runs match this filter.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openRun(item.runId)}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-muted"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                    <span className="truncate text-sm text-foreground">{item.summary}</span>
                  </div>
                  <DemoRunStatusBadge status={item.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
