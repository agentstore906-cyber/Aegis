import Link from "next/link";

import { AgentStatusBadge, RiskBadge, TrustBadge } from "@/components/dashboard/status-badges";
import { StateLine, type PanelTone } from "@/components/console/primitives";
import type { AgentListSignals } from "@/lib/agents/list-signals";
import type { ConnectionState } from "@/lib/agents/connection-state";
import { formatRelativeTime } from "@/lib/utils";
import type { Agent } from "@prisma/client";

type AgentRow = Agent & { signals?: AgentListSignals };

const ENVIRONMENT: Record<string, string> = { PRODUCTION: "Production", STAGING: "Staging", DEVELOPMENT: "Development" };
const CONNECTION_TONE: Record<ConnectionState, PanelTone> = {
  CONNECTED: "safe",
  WAITING: "neutral",
  CREDENTIAL_VERIFIED: "neutral",
  NOT_SEEN_RECENTLY: "warning",
  ERROR: "warning",
  REVOKED: "blocked",
};

/**
 * One row per agent: who it is, whether it is connected, how risky, how trusted, when it last did something.
 * Every value is read from the backend; a trust score appears only when the trust engine has evaluated the agent.
 */
export function AgentsTable({ agents }: { agents: AgentRow[] }) {
  return (
    <div>
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_1.2fr_0.8fr_1fr_1fr] gap-4 px-4 pb-2 text-sm text-muted-foreground md:grid">
        <span>Agent</span>
        <span>Connection</span>
        <span>Risk</span>
        <span>Trust</span>
        <span>Last activity</span>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {agents.map((agent) => {
          const s = agent.signals;
          return (
            <li key={agent.id}>
              <Link
                href={`/agents/${agent.slug}`}
                className="focus-ring grid items-center gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-surface-muted md:grid-cols-[minmax(0,2fr)_1.2fr_0.8fr_1fr_1fr]"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{agent.name}</span>
                    {agent.status !== "ACTIVE" && <AgentStatusBadge status={agent.status} />}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{ENVIRONMENT[agent.environment] ?? agent.environment}</span>
                </span>
                <span className="text-sm">
                  <span className="sr-only">Connection: </span>
                  {s ? <StateLine tone={CONNECTION_TONE[s.connection.state]}>{s.connection.label}</StateLine> : <span className="text-muted-foreground">—</span>}
                </span>
                <span className="text-sm">
                  <span className="sr-only">Risk: </span>
                  <RiskBadge level={agent.riskLevel} />
                </span>
                <span className="num text-sm">
                  <span className="sr-only">Trust: </span>
                  {s?.trust ? (
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{s.trust.score}</span>
                      <TrustBadge state={s.trust.state} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not evaluated</span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  <span className="sr-only">Last activity: </span>
                  {agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : "No activity yet"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
