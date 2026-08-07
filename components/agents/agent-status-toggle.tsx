"use client";

import { useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setAgentStatusAction } from "@/lib/agents/actions";
import type { AgentStatus } from "@prisma/client";

export function AgentStatusToggle({ slug, status }: { slug: string; status: AgentStatus }) {
  const [isPending, startTransition] = useTransition();
  const isPaused = status === "PAUSED";

  if (status === "ARCHIVED") return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(() => {
          setAgentStatusAction(slug, isPaused ? "ACTIVE" : "PAUSED");
        })
      }
    >
      {isPaused ? (
        <>
          <Play className="size-3.5" aria-hidden="true" />
          {isPending ? "Resuming…" : "Resume"}
        </>
      ) : (
        <>
          <Pause className="size-3.5" aria-hidden="true" />
          {isPending ? "Pausing…" : "Pause"}
        </>
      )}
    </Button>
  );
}
