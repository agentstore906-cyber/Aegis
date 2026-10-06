"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { connectAgentAction } from "@/lib/agents/connect-actions";

import { AgentDetected } from "./connection/agent-detected";
import { ConnectionCredential } from "./connection/connection-credential";
import { ConnectionError } from "./connection/connection-error";
import { ConnectionInstructions } from "./connection/connection-instructions";
import { HandshakeState } from "./connection/handshake-state";
import { useConnectionStatus } from "./connection/use-connection-status";

type Environment = "PRODUCTION" | "STAGING" | "DEVELOPMENT";

/**
 * Connect a REAL agent, in two screens: name it, then run it. Aegis creates the identity and a credential that
 * works only for that agent in this organization; the customer never sees or types an identifier.
 *
 * Nothing here creates a demo agent, and nothing here declares success: the second screen polls the backend and
 * switches to "connected" only when it reports that a request authenticated with this agent's own credential
 * has reached Aegis.
 */
export function AgentConnectionWizard({ atLimit }: { atLimit: boolean }) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("PRODUCTION");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; name: string; secret: string | null; keyLimitReached: boolean } | null>(null);

  const { snapshot, problem, checkedAt, recheck } = useConnectionStatus(created?.slug ?? null, {
    stopWhen: (s) => s.view.state === "CONNECTED" && s.eventsObserved > 0,
  });
  const connected = snapshot?.view.state === "CONNECTED";
  const validName = name.trim().length >= 2;

  function create() {
    if (!validName || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await connectAgentAction({ connectorType: "CUSTOM_SDK", agentName: name.trim(), environment });
      if (!result.ok) {
        setError("error" in result ? result.error : "Aegis needs a choice before it can continue.");
        return;
      }
      setCreated({ slug: result.agentSlug, name: result.agentName, secret: result.apiKeyRaw ?? null, keyLimitReached: Boolean(result.apiKeyLimitReached) });
    });
  }

  if (atLimit && !created) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-muted-foreground">You&rsquo;re at your plan&rsquo;s agent limit. Upgrade to connect another agent.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-8">
      {!created && (
        <form
          className="aegis-enter space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Connect your agent</h2>
          </div>
          <div>
            <Label htmlFor="agent-name">Agent name</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer Support Agent" maxLength={80} autoFocus />
          </div>
          <details className="group text-sm">
            <summary className="focus-ring inline-block cursor-pointer list-none rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">Advanced options</summary>
            <div className="mt-3">
              <Label htmlFor="agent-environment">Environment</Label>
              <Select id="agent-environment" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
              </Select>
            </div>
          </details>
          {error && <ConnectionError title="Could not connect the agent" message={error} onRetry={create} />}
          <Button type="submit" size="lg" disabled={!validName || pending} className="w-full">
            {pending ? "Setting up…" : "Continue"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Nothing is connected until your agent actually reaches Aegis.</p>
        </form>
      )}

      {created && (
        <div className="aegis-enter space-y-6">
          {connected && snapshot ? (
            <AgentDetected snapshot={snapshot} />
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Your agent is ready</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Agent: <span className="font-medium text-foreground">{created.name}</span>
                </p>
              </div>

              {created.secret ? (
                <>
                  <ConnectionCredential secret={created.secret} />
                  <ConnectionInstructions secret={created.secret} />
                </>
              ) : (
                <ConnectionError
                  title="No credential was issued"
                  message={
                    created.keyLimitReached
                      ? "Your plan's API key limit is reached, so Aegis could not issue a credential for this agent."
                      : "Aegis could not issue a credential for this agent."
                  }
                  reasons={created.keyLimitReached ? ["Revoke an unused key under Developers › API keys, then issue a credential from the agent page."] : undefined}
                />
              )}

              {snapshot && (snapshot.view.state === "REVOKED" || snapshot.view.state === "ERROR") ? (
                <ConnectionError title={snapshot.view.stateLabel} message={snapshot.view.reason ?? snapshot.view.detail} onRetry={() => void recheck()} />
              ) : (
                <HandshakeState snapshot={snapshot} problem={problem} checkedAt={checkedAt} />
              )}

              <p className="text-xs text-muted-foreground">
                You can leave this page. The agent stays in Aegis as <em>waiting</em> until it connects.{" "}
                <Link href={`/agents/${created.slug}`} className="underline">
                  Open the agent page
                </Link>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
