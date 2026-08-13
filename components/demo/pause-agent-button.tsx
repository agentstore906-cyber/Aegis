"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemo } from "./demo-context";
import type { DemoAgentStatus } from "./types";

export function PauseAgentButton({ agentId, status }: { agentId: string; status: DemoAgentStatus }) {
  const { pauseAgent, resumeAgent } = useDemo();
  const [pending, setPending] = useState(false);

  const isPaused = status === "paused";

  function handleClick() {
    setPending(true);
    // Local demo state only — no network request.
    window.setTimeout(() => {
      if (isPaused) resumeAgent(agentId);
      else pauseAgent(agentId);
      setPending(false);
    }, 250);
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={pending}>
      {isPaused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
      {pending ? (isPaused ? "Resuming…" : "Pausing…") : isPaused ? "Resume agent" : "Pause agent"}
    </Button>
  );
}
