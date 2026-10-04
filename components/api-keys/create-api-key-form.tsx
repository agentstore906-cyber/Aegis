"use client";

import { useActionState, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Label, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CopyButton } from "@/components/ui/copy-button";
import { createApiKeyAction, type CreateApiKeyState } from "@/lib/api-keys/actions";
import { API_KEY_ENVIRONMENTS } from "@/lib/validation/api-key";

const initialState: CreateApiKeyState = {};

export function CreateApiKeyForm({ agents }: { agents: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createApiKeyAction, initialState);
  const [dismissed, setDismissed] = useState(false);

  if (state.createdKey && !dismissed) {
    return (
      <div className="rounded-lg border border-warning-border bg-warning-bg p-5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Save this key now. You won&rsquo;t be able to view it again.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              &ldquo;{state.createdKey.name}&rdquo; ({state.createdKey.environment.toLowerCase()}) has been created.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground">
                {state.createdKey.raw}
              </code>
              <CopyButton value={state.createdKey.raw} label="Copy key" />
            </div>

            <div className="mt-4">
              <Button type="button" size="sm" onClick={() => setDismissed(true)}>
                I&rsquo;ve saved it
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setDismissed(false);
        formAction(formData);
      }}
      className="space-y-4 rounded-lg border border-border bg-surface p-5"
    >
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required maxLength={60} placeholder="Finance Agent — production" />
        </div>

        <div>
          <Label htmlFor="environment">Environment</Label>
          <Select id="environment" name="environment" defaultValue="LIVE">
            {API_KEY_ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env.charAt(0) + env.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="sm:max-w-md">
        <Label htmlFor="agentId">Agent access</Label>
        <Select id="agentId" name="agentId" defaultValue="">
          <option value="">All agents in this organization</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              Only {agent.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          A key limited to one agent can only send that agent&rsquo;s events, evaluate its actions, and read its
          approvals — and cannot register new agents. Prefer this for keys deployed with a single agent.
        </p>
      </div>

      <label className="flex max-w-xl items-start gap-2 text-sm text-foreground">
        <input type="checkbox" name="adminAccess" className="mt-1" />
        <span>
          <strong>Admin tooling access</strong> — allow policy simulation and the organization-wide agent inventory over the API (for CI and governance reporting).
          <span className="block text-xs text-muted-foreground">
            Off by default and only for &ldquo;All agents&rdquo; keys. Never put this key in an agent: simulation explains how Aegis detects and scores risk.
          </span>
        </span>
      </label>

      <div className="sm:w-48">
        <Label htmlFor="expiresInDays">Expiration</Label>
        <Select id="expiresInDays" name="expiresInDays" defaultValue="">
          <option value="">Never</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </Select>
      </div>

      <div className="border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create API key"}
        </Button>
      </div>
    </form>
  );
}
