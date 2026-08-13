"use client";

import { useActionState, useState } from "react";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CopyButton } from "@/components/ui/copy-button";
import { createWebhookEndpointAction, type CreateWebhookEndpointState } from "@/lib/webhooks/actions";
import { WEBHOOK_EVENT_TYPES } from "@/lib/validation/webhook";

const initialState: CreateWebhookEndpointState = {};

export function CreateWebhookForm() {
  const [state, formAction, pending] = useActionState(createWebhookEndpointAction, initialState);
  const [dismissed, setDismissed] = useState(false);

  if (state.createdEndpoint && !dismissed) {
    return (
      <div className="rounded-lg border border-warning-border bg-warning-bg p-4">
        <p className="text-sm font-medium text-foreground">
          Save this signing secret now. You won&rsquo;t be able to view it again.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Endpoint: {state.createdEndpoint.url}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground">
            {state.createdEndpoint.secret}
          </code>
          <CopyButton value={state.createdEndpoint.secret} label="Copy secret" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Verify deliveries with the HMAC-SHA256 signature in the <code>X-Aegis-Signature</code> header.
        </p>
        <Button type="button" size="sm" className="mt-3" onClick={() => setDismissed(true)}>
          Done
        </Button>
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

      <div>
        <Label htmlFor="url">Endpoint URL</Label>
        <Input id="url" name="url" type="url" required maxLength={500} placeholder="https://example.com/webhooks/aegis" />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Events</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WEBHOOK_EVENT_TYPES.map((eventType) => (
            <label key={eventType} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="subscribedEvents" value={eventType} className="size-4 rounded border-border" />
              <span className="font-mono text-xs">{eventType}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create endpoint"}
      </Button>
    </form>
  );
}
