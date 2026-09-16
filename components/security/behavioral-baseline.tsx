import type { BehavioralBaseline } from "@/lib/security/baseline";
import { formatCurrency } from "@/lib/utils";

/**
 * Renders a per-agent behavioral baseline (Phase 2 spec §1). Honest about
 * the "insufficient data" case (spec: never claim a baseline computed
 * from too little history) rather than showing a number derived from one
 * or two events.
 */
export function BehavioralBaselineCard({ baseline }: { baseline: BehavioralBaseline }) {
  if (!baseline.available) {
    return (
      <div>
        <p className="text-sm font-medium text-foreground">Insufficient data</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {baseline.eventsObserved === 0
            ? "This agent hasn't reported any activity yet."
            : `Only ${baseline.eventsObserved} event${baseline.eventsObserved === 1 ? "" : "s"} observed over ${baseline.daysObserved} day${baseline.daysObserved === 1 ? "" : "s"} — not enough history for a reliable baseline yet.`}
        </p>
      </div>
    );
  }

  const metrics: { label: string; value: string }[] = [
    { label: "Events/day", value: formatRate(baseline.eventsPerDay) },
    { label: "Tool calls/day", value: formatRate(baseline.toolCallsPerDay) },
    { label: "Model calls/day", value: formatRate(baseline.modelCallsPerDay) },
    { label: "Data access/day", value: formatRate(baseline.dataAccessPerDay) },
    { label: "Deletes/day", value: formatRate(baseline.destructiveActionsPerDay) },
    { label: "Comms/day", value: formatRate(baseline.communicationsPerDay) },
    { label: "Failed/day", value: formatRate(baseline.failedPerDay) },
    { label: "Blocked/day", value: formatRate(baseline.blockedPerDay) },
  ];

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Based on {baseline.eventsObserved} events over the last {baseline.daysObserved} day
        {baseline.daysObserved === 1 ? "" : "s"} of observed history.
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-foreground">{metric.value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted-foreground">Cost/day</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-foreground">
            {baseline.costCentsPerDay === null ? "No cost data" : formatCurrency(baseline.costCentsPerDay)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatRate(n: number): string {
  return n < 10 ? n.toFixed(1) : Math.round(n).toString();
}
