import Link from "next/link";
import { ActivityStatusBadge } from "@/components/dashboard/status-badges";
import { formatRelativeTime } from "@/lib/utils";
import type { ActivityStatus } from "@prisma/client";

export function ActivityRow({
  timestamp,
  agentName,
  agentSlug,
  action,
  resource,
  toolName,
  description,
  status,
  source,
}: {
  timestamp: Date;
  agentName?: string;
  agentSlug?: string;
  action: string;
  resource?: string | null;
  toolName?: string | null;
  description?: string | null;
  status: ActivityStatus;
  source?: string | null;
}) {
  const what = description || action.replaceAll(/[._]/g, " ");
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-foreground">
          {agentName && agentSlug ? (
            <Link href={`/agents/${agentSlug}`} className="focus-ring rounded-sm font-medium hover:underline">
              {agentName}
            </Link>
          ) : null}
          {agentName ? <span className="text-muted-foreground"> requested </span> : null}
          <span className="font-medium">{what}</span>
        </p>
        {(resource || toolName) && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {resource}
            {resource && toolName ? " · " : ""}
            {toolName && <>via {toolName}</>}
          </p>
        )}
        <p className="mt-0.5 text-sm text-muted-foreground" title={timestamp.toISOString()}>
          {formatRelativeTime(timestamp)}
        </p>
      </div>
      <div className="shrink-0 pt-0.5">
        <ActivityStatusBadge status={status} source={source} />
      </div>
    </div>
  );
}
