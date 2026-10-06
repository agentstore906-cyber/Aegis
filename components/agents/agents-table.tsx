import Link from "next/link";

import { AgentStatusBadge } from "@/components/dashboard/status-badges";
import { StateLine, type PanelTone } from "@/components/console/primitives";
import type { AgentListSignals } from "@/lib/agents/list-signals";
import type { ConnectionState } from "@/lib/agents/connection-state";
import { formatRelativeTime } from "@/lib/utils";
import type { Agent } from "@prisma/client";

type AgentRow = Agent & { signals?: AgentListSignals };

const CONNECTION_TONE: Record<ConnectionState, PanelTone> = {
  CONNECTED: "safe",
  WAITING: "neutral",
  CREDENTIAL_VERIFIED: "neutral",
  NOT_SEEN_RECENTLY: "warning",
  ERROR: "warning",
  REVOKED: "blocked",
};

/**
 * One quiet row per agent: its name, its real connection state, and when Aegis last heard from it.
 * Risk, trust and everything else live on the agent page. The status line comes from the evidence-derived
 * connection view, so "Connected" and "Monitoring active" appear only when the backend confirms them.
 */
export function AgentsTable({ agents }: { agents: AgentRow[] }) {
  return (
    <ul aria-label="Your AI agents" className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {agents.map((agent) => {
        const c = agent.signals?.connection;
        return (
          <li key={agent.id}>
            <Link
              href={`/agents/${agent.slug}`}
              className="focus-ring flex flex-col gap-1 px-4 py-4 transition-colors hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{agent.name}</span>
                  {agent.status !== "ACTIVE" && <AgentStatusBadge status={agent.status} />}
                </span>
                <span className="mt-1 block">
                  {c ? <StateLine tone={CONNECTION_TONE[c.state]}>{c.summary}</StateLine> : <span className="text-sm text-muted-foreground">—</span>}
                </span>
              </span>
              <span className="shrink-0 pl-4 text-sm text-muted-foreground sm:pl-0">
                {c?.lastSeenAt ? `Last seen ${formatRelativeTime(c.lastSeenAt)}` : "Not seen yet"}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
