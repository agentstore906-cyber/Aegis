"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { connectEndpointAgentAction } from "@/lib/agents/connect-actions";

import { ConnectionError } from "./connection/connection-error";

type Environment = "PRODUCTION" | "STAGING" | "DEVELOPMENT";

type Failure = { code: string; error: string };
type Connected = { agentSlug: string; agentName: string; verifiedAtIso: string; reconnected: boolean };

/** What the backend actually determined for a failure code; nothing here is a guess. */
const FAILURE_HINTS: Record<string, string[]> = {
  UNREACHABLE: ["Check the URL and port, and that the agent is running and reachable from the internet."],
  TIMEOUT: ["The agent must answer within a few seconds."],
  TLS_ERROR: ["The endpoint needs a valid HTTPS certificate for its host name."],
  UNSAFE_URL: ["Use the agent's public HTTPS endpoint. Aegis does not connect to private or internal addresses."],
  AUTH_REJECTED: ["Enter the same shared secret that is configured in the agent."],
  BAD_PROOF: ["Enter the same shared secret that is configured in the agent."],
  NOT_AGENT: ["The URL must be the agent's aegis-agent/1 endpoint, not a website or another API."],
  REDIRECTED: ["Enter the final URL, without a redirect."],
};

/**
 * Connect a REAL external agent. Aegis connects to it: you give the agent's endpoint and the shared secret, Aegis makes
 * a signed request, and the agent must prove it holds the secret. Only then does anything exist in Aegis — a failed
 * attempt creates nothing, and nothing here ever says "connected" before the backend has verified the agent.
 */
export function AgentConnectionWizard({ atLimit }: { atLimit: boolean }) {
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("PRODUCTION");
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [connected, setConnected] = useState<Connected | null>(null);

  const valid = endpointUrl.trim().length >= 8 && secret.length >= 16;

  function connect() {
    if (!valid || pending) return;
    setFailure(null);
    startTransition(async () => {
      const result = await connectEndpointAgentAction({
        endpointUrl: endpointUrl.trim(),
        secret,
        displayName: displayName.trim() || undefined,
        environment,
      });
      if (!result.ok) {
        setFailure({ code: result.code, error: result.error });
        return;
      }
      setSecret(""); // the secret is not kept in the page once Aegis has stored it
      setConnected({ agentSlug: result.agentSlug, agentName: result.agentName, verifiedAtIso: result.verifiedAtIso, reconnected: result.reconnected });
    });
  }

  if (atLimit && !connected) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-muted-foreground">You&rsquo;re at your plan&rsquo;s agent limit. Upgrade to connect another agent.</p>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="aegis-node aegis-enter px-5 py-9 text-center sm:px-8">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Connected</h2>
        <p className="mt-2 text-lg font-medium text-foreground">{connected.agentName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Aegis connected to your agent and verified it
          <time dateTime={connected.verifiedAtIso}> · {new Date(connected.verifiedAtIso).toLocaleString()}</time>
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <ButtonLink href={`/risk-scan?agent=${encodeURIComponent(connected.agentSlug)}#scan`}>Scan Agent</ButtonLink>
          <ButtonLink href={`/agents/${connected.agentSlug}`} variant="secondary">
            View agent
          </ButtonLink>
          <ButtonLink href="/agents/new" variant="ghost">
            Connect another agent
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="aegis-node px-5 py-7 sm:px-8 sm:py-9">
      <form
        className="aegis-enter space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          connect();
        }}
      >
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Connect your agent</h2>
          <p className="mt-2 text-sm text-muted-foreground">Aegis connects to your agent and verifies it before anything is added.</p>
        </div>
        <div>
          <Label htmlFor="agent-endpoint">Agent endpoint URL</Label>
          <Input id="agent-endpoint" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://your-agent.example.com/aegis" inputMode="url" autoComplete="off" maxLength={300} autoFocus />
        </div>
        <div>
          <Label htmlFor="agent-secret">Shared secret</Label>
          <Input id="agent-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" maxLength={200} />
          <p className="mt-1.5 text-xs text-muted-foreground">The secret your agent uses to verify Aegis (16+ characters). Aegis stores it encrypted and never shows it again.</p>
        </div>
        <details className="group text-sm">
          <summary className="focus-ring inline-block cursor-pointer list-none rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">Advanced options</summary>
          <div className="mt-3 space-y-4">
            <div>
              <Label htmlFor="agent-display-name">Display name</Label>
              <Input id="agent-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Defaults to the name your agent reports" maxLength={80} />
            </div>
            <div>
              <Label htmlFor="agent-environment">Environment</Label>
              <Select id="agent-environment" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
              </Select>
            </div>
          </div>
        </details>
        {failure && (
          <ConnectionError title="Aegis couldn't connect to your agent" message={failure.error} reasons={FAILURE_HINTS[failure.code]} onRetry={valid && !pending ? connect : undefined} />
        )}
        <Button type="submit" size="lg" disabled={!valid || pending} className="w-full">
          {pending ? "Connecting to your agent…" : "Connect Agent"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Your agent must expose an Aegis endpoint (aegis-agent/1). Nothing is added to Aegis unless the agent answers.</p>
      </form>
    </div>
  );
}
