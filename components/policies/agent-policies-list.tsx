import Link from "next/link";
import { DecisionBadge, PolicyStatusBadge } from "@/components/dashboard/status-badges";
import { describePolicy } from "@/lib/policies/describe";
import type { PolicyWithConditions } from "@/lib/policies/matcher";

export function AgentPoliciesList({
  policies,
  agentName,
}: {
  policies: PolicyWithConditions[];
  agentName: string;
}) {
  return (
    <ul className="divide-y divide-border">
      {policies.map((policy) => (
        <li key={policy.id} className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/policies/${policy.id}/edit`}
              className="focus-ring rounded-sm font-medium text-foreground hover:underline"
            >
              {policy.name}
            </Link>
            <div className="flex items-center gap-2">
              <PolicyStatusBadge status={policy.status} />
              <DecisionBadge decision={policy.decision} />
            </div>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {describePolicy({
              agentName: policy.agentId ? agentName : null,
              action: policy.action,
              resource: policy.resource,
              environment: policy.environment,
              tool: policy.tool,
              riskLevel: policy.riskLevel,
              decision: policy.decision,
              conditions: policy.conditions,
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}
