"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldHint } from "@/components/ui/field";
import { connectAgentAction } from "@/lib/agents/connect-actions";
import { cn } from "@/lib/utils";

import { AgentDetected } from "./connection/agent-detected";
import { ConnectionCredential } from "./connection/connection-credential";
import { ConnectionError } from "./connection/connection-error";
import { ConnectionInstructions } from "./connection/connection-instructions";
import { HandshakeState } from "./connection/handshake-state";
import { useConnectionStatus } from "./connection/use-connection-status";

type Step = "intro" | "identify" | "method" | "waiting";
type Environment = "PRODUCTION" | "STAGING" | "DEVELOPMENT";

const PHASES = ["Connect", "Verify", "Ready"] as const;

/**
 * Connect a REAL agent. Nothing here creates a demo agent, and nothing here declares success: the "waiting"
 * screen polls the backend, and the "detected" screen appears only when the backend reports that a request
 * authenticated with this agent's own credential has reached Aegis.
 */
export function AgentConnectionWizard({ atLimit }: { atLimit: boolean }) {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<Environment>("PRODUCTION");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; secret: string | null; keyLimitReached: boolean } | null>(null);

  const { snapshot, problem, checkedAt, recheck } = useConnectionStatus(created?.slug ?? null, {
    stopWhen: (s) => s.view.state === "CONNECTED" && s.eventsObserved > 0,
  });
  const connected = snapshot?.view.state === "CONNECTED";
  const phase = connected ? 2 : step === "waiting" ? 1 : 0;

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await connectAgentAction({ connectorType: "CUSTOM_SDK", agentName: name, environment });
      if (!result.ok) {
        setError("error" in result ? result.error : "Aegis needs a choice before it can continue.");
        return;
      }
      setCreated({ slug: result.agentSlug, secret: result.apiKeyRaw ?? null, keyLimitReached: Boolean(result.apiKeyLimitReached) });
      setStep("waiting");
    });
  }

  if (atLimit && step === "intro") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-muted-foreground">You&rsquo;re at your plan&rsquo;s agent limit. Upgrade to connect another agent.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <ol aria-label="Progress" className="flex items-center gap-2 border-b border-border px-6 py-3">
        {PHASES.map((label, i) => (
          <li key={label} aria-current={i === phase ? "step" : undefined} className="flex items-center gap-2">
            <span className={cn("section-label", i === phase ? "text-foreground" : i < phase ? "text-success" : "")}>{label}</span>
            {i < PHASES.length - 1 && <span aria-hidden="true" className="h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      <div className="px-6 py-8">
        {step === "intro" && (
          <div className="aegis-enter text-center">
            <ShieldCheck className="mx-auto size-8 text-brand" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Connect your agent</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Your agent stays on your infrastructure.
              <br />
              Aegis becomes its control layer.
            </p>
            <div className="mt-6">
              <Button size="lg" onClick={() => setStep("identify")}>
                Connect
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Have an OpenAI or Anthropic key instead? See <span className="text-foreground">Advanced setup</span> below.
            </p>
          </div>
        )}

        {step === "identify" && (
          <form
            className="aegis-enter space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) setStep("method");
            }}
          >
            <Back onClick={() => setStep("intro")} />
            <h2 className="text-lg font-semibold text-foreground">Identify your agent</h2>
            <div>
              <Label htmlFor="agent-name">Agent name</Label>
              <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer Support Agent" maxLength={80} autoFocus />
              <FieldHint>The name of the agent you already run. Aegis does not create one.</FieldHint>
            </div>
            <div>
              <Label htmlFor="agent-environment">Environment</Label>
              <Select id="agent-environment" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
              </Select>
            </div>
            <Button type="submit" disabled={name.trim().length < 2}>
              Continue
            </Button>
          </form>
        )}

        {step === "method" && (
          <div className="aegis-enter space-y-5">
            <Back onClick={() => setStep("identify")} />
            <h2 className="text-lg font-semibold text-foreground">Create the connection</h2>
            <div className="rounded-lg border border-border bg-surface-muted p-4">
              <p className="section-label">Recommended</p>
              <p className="mt-1.5 text-sm font-medium text-foreground">Simple connection</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Aegis issues a credential that works only for <strong className="font-medium text-foreground">{name.trim()}</strong>, in your organization. You add it to your agent and run it once.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing is connected yet. The connection is confirmed only when your agent actually reaches Aegis.
            </p>
            {error && <ConnectionError title="Could not create the connection" message={error} onRetry={create} />}
            <Button onClick={create} disabled={pending}>
              {pending ? "Creating…" : "Create credential"}
            </Button>
          </div>
        )}

        {step === "waiting" && created && (
          <div className="aegis-enter space-y-6">
            {connected && snapshot ? (
              <AgentDetected snapshot={snapshot} />
            ) : (
              <>
                <div>
                  <p className="section-label">Waiting for your agent</p>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">Connect your agent to Aegis</h2>
                </div>

                {created.secret ? (
                  <ConnectionCredential secret={created.secret} />
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

                {created.secret && <ConnectionInstructions />}

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
    </div>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3" aria-hidden="true" />
      Back
    </button>
  );
}
