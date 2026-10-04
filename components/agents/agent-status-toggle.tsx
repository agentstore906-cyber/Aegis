"use client";

import { useState, useTransition } from "react";
import { Pause, Play, Octagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { setAgentStatusAction, type AgentControlState } from "@/lib/agents/actions";
import type { AgentStatus } from "@prisma/client";

/**
 * The agent kill switch. Every control action reports back whether it was
 * actually enforced on the external agent (see lib/enforcement/) — today it
 * never is, so the truthful outcome banner is not an edge case, it is what
 * every action shows. Never render a plain "Agent stopped" success state
 * without it.
 */
export function AgentStatusToggle({ slug, status }: { slug: string; status: AgentStatus }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "ARCHIVED") return null;

  function setStatus(next: AgentControlState) {
    setError(null);
    startTransition(async () => {
      const result = await setAgentStatusAction(slug, next);
      if (result.error) {
        setError(result.error);
        setMessage(null);
      } else if (result.outcome) {
        setMessage(result.outcome.detail);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "PAUSED" || status === "STOPPED" ? (
          <Button variant="secondary" size="sm" disabled={isPending} onClick={() => setStatus("ACTIVE")}>
            <Play className="size-3.5" aria-hidden="true" />
            {isPending ? "Resuming…" : "Resume"}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={isPending} onClick={() => setStatus("PAUSED")}>
            <Pause className="size-3.5" aria-hidden="true" />
            {isPending ? "Pausing…" : "Pause"}
          </Button>
        )}

        {status !== "STOPPED" && (
          <ConfirmDialog
            title="Stop agent"
            description="Aegis will refuse (BLOCK) every authorization request this agent makes until it's resumed. Aegis has no enforcement connector for this connection, so it can't halt the agent's process or stop actions it takes without asking Aegis first — see the notice after confirming."
            confirmLabel="Stop agent"
            onConfirm={() => setStatus("STOPPED")}
            trigger={
              <Button variant="secondary" size="sm" type="button" disabled={isPending} className="text-danger hover:bg-danger-bg">
                <Octagon className="size-3.5" aria-hidden="true" />
                Stop
              </Button>
            }
          />
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="warning">{message}</Alert>}
    </div>
  );
}
