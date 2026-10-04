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
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-20 shrink-0 text-xs text-muted-foreground" title={timestamp.toISOString()}>
          {formatRelativeTime(timestamp)}
        </span>
        {agentName && agentSlug && (
          <Link
            href={`/agents/${agentSlug}`}
            className="focus-ring w-32 shrink-0 truncate rounded-sm font-medium text-foreground hover:underline"
          >
            {agentName}
          </Link>
        )}
        <div className="min-w-0">
          <p className="truncate text-foreground">
            {description || action.replaceAll(/[._]/g, " ")}
            {toolName && <span className="ml-1.5 text-xs text-muted-foreground">via {toolName}</span>}
          </p>
          {resource && <p className="truncate text-xs text-muted-foreground">{resource}</p>}
        </div>
      </div>
      <ActivityStatusBadge status={status} source={source} />
    </div>
  );
}
