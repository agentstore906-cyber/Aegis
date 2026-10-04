import Link from "next/link";

import { DecisionBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SimulationResult } from "@/lib/control/simulate";

/** The read-only answer to "what would Aegis do?" — stage by stage, in precedence order. Nothing here was recorded. */
export function SimulationResultView({ simulation }: { simulation: SimulationResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Simulation <Badge tone="neutral">nothing recorded</Badge>
        </CardTitle>
        <DecisionBadge decision={simulation.decision} />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground">{simulation.reason}</p>
        <p className="text-xs text-muted-foreground">
          Decided by <span className="text-foreground">{simulation.decisionSource.replaceAll("_", " ").toLowerCase()}</span> · policies alone:{" "}
          <span className="text-foreground">{simulation.policyDecision.replaceAll("_", " ").toLowerCase()}</span> · matching {simulation.matchingMode.toLowerCase()} ·{" "}
          {simulation.agent.name} ({simulation.agent.environment.toLowerCase()}, {simulation.agent.status.toLowerCase()})
        </p>

        <ol className="space-y-2">
          {simulation.stages.map((stage) => (
            <li key={stage.stage} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.stage.replaceAll("_", " ")}</span>
                {stage.decisive && <Badge tone="brand">decided here</Badge>}
              </div>
              <p className="text-foreground">{stage.summary}</p>
            </li>
          ))}
        </ol>

        {simulation.risk && simulation.risk.reasons.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk reasons</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
              {simulation.risk.reasons.map((r) => (
                <li key={r.rank}>{r.summary}</li>
              ))}
            </ol>
          </div>
        )}

        {simulation.approval.required && (
          <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
            A real run would open an approval request for {simulation.approval.reviewerRoles.join(", ").toLowerCase()} to decide. {simulation.approval.note}
          </p>
        )}

        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          <p>{simulation.enforcement.note}</p>
          <p className="mt-2">
            To record a real evaluation (this counts toward the agent&rsquo;s trust and history), switch to &ldquo;Record&rdquo;.{" "}
            <Link href={`/agents/${simulation.agent.slug}?tab=control`} className="text-foreground hover:underline">
              Agent control view
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
