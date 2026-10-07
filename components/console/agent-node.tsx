import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, ShieldAlert, XCircle, type LucideIcon } from "lucide-react";
import type { AgentStatus } from "@prisma/client";

import type { ConnectionState, MonitoringState } from "@/lib/agents/connection-state";
import { AGENT_STATE } from "@/lib/ui/vocabulary";
import { cn, formatRelativeTime } from "@/lib/utils";
import { PresentationBadge } from "@/components/dashboard/status-badges";
import type { CoreNodeTone } from "@/components/console/aegis-core";

type StatusCopy = { label: string; tone: CoreNodeTone; icon: LucideIcon };

/** The backend's connection state, in the console's voice. Words first; the dot and color only reinforce. */
export const CONNECTION_STATUS: Record<ConnectionState, StatusCopy> = {
  CONNECTED: { label: "Connected", tone: "safe", icon: CheckCircle2 },
  WAITING: { label: "Not connected yet", tone: "neutral", icon: CircleDashed },
  CREDENTIAL_VERIFIED: { label: "Credential verified", tone: "neutral", icon: CircleDashed },
  NOT_SEEN_RECENTLY: { label: "Not seen recently", tone: "warning", icon: Clock },
  ERROR: { label: "Connection problem", tone: "warning", icon: AlertTriangle },
  REVOKED: { label: "Disconnected", tone: "blocked", icon: XCircle },
};

const DOT: Record<CoreNodeTone, string> = { safe: "bg-success", warning: "bg-warning", blocked: "bg-danger", neutral: "bg-muted-foreground" };

/** Whether Aegis is actually receiving the agent's activity — never "active" unless the backend says events arrive. */
export function monitoringCopy(state: ConnectionState, monitoring: MonitoringState): string {
  if (state === "REVOKED" || state === "ERROR") return "Not receiving";
  if (monitoring === "RECEIVING") return "Monitoring active";
  if (monitoring === "QUIET") return "No recent activity";
  return "Not monitored yet";
}

export type AgentNodeData = {
  slug: string;
  name: string;
  status: AgentStatus;
  connection: { state: ConnectionState; monitoring: MonitoringState; lastSeenAt: Date | null };
  /** When the agent last did something Aegis recorded. Null when nothing has been recorded (a connection check is not activity). */
  lastActivityAt: Date | null;
  /** Open security alerts. Undefined when the viewer may not see security data (nothing is implied). */
  openAlerts?: number;
};

/**
 * One agent. Every line is a stored or derived fact: connection and monitoring from the evidence-based derivation,
 * alerts from stored security alerts, last activity from the last time the backend heard from it. There is no score,
 * no risk label and no claim of safety on an agent card.
 */
export function AgentNode({ agent, index = 0 }: { agent: AgentNodeData; index?: number }) {
  const conn = CONNECTION_STATUS[agent.connection.state];
  const alerts = agent.openAlerts ?? 0;
  const nodeTone: CoreNodeTone | "risk" = alerts > 0 ? "warning" : conn.tone;
  const live = agent.connection.state === "CONNECTED" && agent.connection.monitoring === "RECEIVING";

  return (
    <li className="aegis-rise" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <article className="aegis-node flex h-full flex-col p-5" data-tone={nodeTone}>
        <header className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
            <Link href={`/agents/${agent.slug}`} className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-[14px] after:content-['']">
              <span className="break-words">{agent.name}</span>
            </Link>
          </h3>
          {agent.status !== "ACTIVE" && <PresentationBadge presentation={AGENT_STATE[agent.status]} />}
        </header>

        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <span aria-hidden="true" className="relative flex size-2">
            {live && <span className="absolute inline-flex size-full rounded-full bg-success opacity-50 motion-safe:animate-ping" />}
            <span className={cn("relative inline-flex size-2 rounded-full", DOT[conn.tone])} />
          </span>
          {conn.label}
        </p>
        <p className="mt-0.5 pl-4 text-sm text-muted-foreground">{monitoringCopy(agent.connection.state, agent.connection.monitoring)}</p>

        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            {agent.lastActivityAt ? "Last activity " : agent.connection.lastSeenAt ? "Last seen " : "No activity received yet"}
            {(agent.lastActivityAt ?? agent.connection.lastSeenAt) && (
              <time dateTime={(agent.lastActivityAt ?? agent.connection.lastSeenAt)!.toISOString()} className="text-foreground">
                {formatRelativeTime((agent.lastActivityAt ?? agent.connection.lastSeenAt)!)}
              </time>
            )}
          </p>
          {agent.openAlerts !== undefined && (
            <p className="flex items-center gap-1.5">
              <ShieldAlert className={cn("size-3.5 shrink-0", alerts > 0 ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
              <span className={alerts > 0 ? "text-foreground" : undefined}>{alerts > 0 ? `${alerts} open ${alerts === 1 ? "alert" : "alerts"}` : "No open alerts"}</span>
            </p>
          )}
        </div>
      </article>
    </li>
  );
}
