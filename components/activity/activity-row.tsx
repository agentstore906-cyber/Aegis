import Link from "next/link";
import { ActivityStatusBadge } from "@/components/dashboard/status-badges";
import { formatTimestamp } from "@/lib/utils";
import type { ActivityStatus } from "@prisma/client";

export function ActivityRow({
  timestamp,
  agentName,
  agentSlug,
  action,
  resource,
  status,
}: {
  timestamp: Date;
  agentName?: string;
  agentSlug?: string;
  action: string;
  resource?: string | null;
  status: ActivityStatus;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
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
          <p className="truncate text-foreground">{action.replaceAll("_", " ")}</p>
          {resource && <p className="truncate text-xs text-muted-foreground">{resource}</p>}
        </div>
      </div>
      <ActivityStatusBadge status={status} />
    </div>
  );
}
