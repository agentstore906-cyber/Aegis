"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { getAgent } from "../data";
import { DemoAlertSeverityBadge, DemoAlertStatusBadge } from "../badges";
import { PauseAgentButton } from "../pause-agent-button";
import { useDemo } from "../demo-context";

export function AlertsView() {
  const { alerts, resolveAlert, openAgent } = useDemo();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set([alerts[0]?.id].filter(Boolean) as string[]));

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deterministic detectors flag unusual agent behavior automatically.
        </p>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => {
          const agent = getAgent(alert.agentId);
          const isOpen = openIds.has(alert.id);
          const isResolved = alert.status === "resolved";
          return (
            <div key={alert.id} className="overflow-hidden rounded-xl border border-border bg-surface">
              <button
                type="button"
                onClick={() => toggle(alert.id)}
                className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                aria-expanded={isOpen}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    <DemoAlertSeverityBadge severity={alert.severity} />
                    <DemoAlertStatusBadge status={alert.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {agent?.name} · {formatRelativeTime(alert.detectedAt)}
                  </p>
                </div>
                <ChevronDown
                  className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </button>

              {isOpen && (
                <div className="border-t border-border px-5 py-4">
                  <p className="text-sm text-foreground">{alert.description}</p>

                  <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {alert.evidence.map((row) => (
                      <div key={row.label} className="rounded-lg border border-border px-3 py-2.5">
                        <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
                        <dd className="mt-0.5 text-sm font-medium text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {agent && alert.action === "pause" && !isResolved && (
                      <PauseAgentButton agentId={agent.id} status={agent.status} />
                    )}
                    {alert.action === "acknowledge" && !isResolved && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => resolveAlert(alert.id)}>
                        Acknowledge
                      </Button>
                    )}
                    {isResolved && (
                      <p className="text-xs text-muted-foreground">
                        Resolved — no further action needed for this alert.
                      </p>
                    )}
                    {agent && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => openAgent(agent.id)}>
                        View agent
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
