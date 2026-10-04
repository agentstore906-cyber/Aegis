"use client";

import { useActionState } from "react";

import { linkScanToAgentAction, type LinkAgentState } from "@/lib/scanner/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";

const initial: LinkAgentState = {};

export function LinkAgentForm({ scanId, agents, currentAgentId }: { scanId: string; agents: { id: string; name: string }[]; currentAgentId: string | null }) {
  const [state, action, pending] = useActionState(linkScanToAgentAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="scanId" value={scanId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && <Alert tone="success">Linked. This scan now appears on that agent’s record.</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="link-agent" className="sr-only">
          Agent
        </label>
        <Select id="link-agent" name="agentId" defaultValue={currentAgentId ?? ""} required>
          <option value="" disabled>
            Choose an agent…
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Linking…" : currentAgentId ? "Change link" : "Link scan to agent"}
        </Button>
      </div>
    </form>
  );
}
