"use client";

import { useTransition } from "react";
import { ArrowBigUp } from "lucide-react";
import type { FeatureRequestStatus } from "@prisma/client";

import { toggleFeatureRequestVoteAction } from "@/lib/feedback/actions";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<FeatureRequestStatus, "neutral" | "info" | "brand" | "success" | "warning"> = {
  REQUESTED: "neutral",
  REVIEWING: "info",
  PLANNED: "brand",
  IN_PROGRESS: "warning",
  SHIPPED: "success",
  DECLINED: "neutral",
};

export type FeatureRequestListItem = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: FeatureRequestStatus;
  createdAt: Date;
  voteCount: number;
  hasVoted: boolean;
  submittedBy: { name: string | null; email: string };
};

function VoteButton({ id, voteCount, hasVoted }: { id: string; voteCount: number; hasVoted: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => toggleFeatureRequestVoteAction(id))}
      aria-pressed={hasVoted}
      className={cn(
        "focus-ring flex w-12 shrink-0 flex-col items-center rounded-md border py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
        hasVoted ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-surface-muted"
      )}
    >
      <ArrowBigUp className={cn("size-4", hasVoted && "fill-brand")} aria-hidden="true" />
      {voteCount}
    </button>
  );
}

export function FeatureRequestList({ requests }: { requests: FeatureRequestListItem[] }) {
  if (requests.length === 0) return null;

  return (
    <ul className="divide-y divide-border">
      {requests.map((request) => (
        <li key={request.id} className="flex gap-3 px-5 py-4">
          <VoteButton id={request.id} voteCount={request.voteCount} hasVoted={request.hasVoted} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{request.title}</p>
              <Badge tone={STATUS_TONE[request.status]}>{request.status.replace("_", " ")}</Badge>
              {request.category && <Badge tone="neutral">{request.category}</Badge>}
            </div>
            {request.description && <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {request.submittedBy.name ?? request.submittedBy.email} · {formatRelativeTime(request.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
