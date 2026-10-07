import { cn } from "@/lib/utils";

import type { ConnectionSnapshotJson } from "./use-connection-status";

type View = ConnectionSnapshotJson["view"];

const TONE: Record<View["state"], string> = {
  WAITING: "bg-muted-foreground",
  CREDENTIAL_VERIFIED: "bg-info",
  CONNECTED: "bg-success",
  NOT_SEEN_RECENTLY: "bg-warning",
  ERROR: "bg-danger",
  REVOKED: "bg-danger",
};

/**
 * Three separate facts about an agent, never merged into one badge: is it CONNECTED, is Aegis MONITORING it, and
 * does it ASK Aegis for decisions. There is no "Protected" state because Aegis returns decisions and cannot stop
 * an agent that ignores them.
 */
export function AgentProtectionStatus({ view, className }: { view: View; className?: string }) {
  const rows: { label: string; value: string; detail?: string; dot?: string }[] = [
    { label: "Connection", value: view.stateLabel, detail: view.reason ?? view.detail, dot: TONE[view.state] },
    {
      label: "Monitoring",
      value: view.monitoringLabel,
      detail: view.monitoring === "NONE" ? "No activity has been reported yet." : `${view.reportedEventCount} reported event${view.reportedEventCount === 1 ? "" : "s"} received.`,
      dot: view.state === "CONNECTED" && view.monitoring === "RECEIVING" ? "bg-success" : "bg-muted-foreground",
    },
    { label: "Decisions", value: view.protectionLabel, detail: view.protectionDetail, dot: view.protection === "ASKS_FOR_DECISIONS" ? "bg-info" : "bg-muted-foreground" },
  ];
  return (
    <dl className={cn("divide-y divide-border rounded-lg border border-border bg-surface", className)}>
      {rows.map((r) => (
        <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
          <dt className="section-label self-center">{r.label}</dt>
          <dd>
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", r.dot)} aria-hidden="true" />
              {r.value}
            </p>
            {r.detail && <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
