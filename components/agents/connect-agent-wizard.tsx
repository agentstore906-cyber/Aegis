"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Sparkles, Wrench, Loader2, CheckCircle2, ArrowLeft, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, FieldHint } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import { discoverConnectionAction, connectAgentAction } from "@/lib/agents/connect-actions";
import type { DiscoveredAgent } from "@/lib/connectors/types";

type ConnectorType = "OPENAI" | "ANTHROPIC" | "CUSTOM_SDK";

type Step = "select" | "credential" | "choose" | "name" | "connecting" | "connected";

const PROVIDERS: { type: ConnectorType; label: string; description: string; icon: typeof Bot }[] = [
  { type: "OPENAI", label: "OpenAI", description: "Connect an Assistant with an API key.", icon: Sparkles },
  { type: "ANTHROPIC", label: "Anthropic", description: "Connect with an API key.", icon: Bot },
  { type: "CUSTOM_SDK", label: "Custom Agent", description: "Any other agent, via the Aegis SDK.", icon: Wrench },
];

const CREDENTIAL_HELP: Record<"OPENAI" | "ANTHROPIC", { label: string; placeholder: string; href: string }> = {
  OPENAI: { label: "OpenAI API key", placeholder: "sk-...", href: "https://platform.openai.com/api-keys" },
  ANTHROPIC: { label: "Anthropic API key", placeholder: "sk-ant-...", href: "https://console.anthropic.com/settings/keys" },
};

/** Purely a display sequence for the connected screen — every item shown was actually true by the time this renders, never a fabricated "in progress" state. */
const CONNECT_STEPS_LABEL: Record<ConnectorType, string[]> = {
  OPENAI: ["Authentication", "Connection verified", "Agent found", "Monitoring ready"],
  ANTHROPIC: ["Authentication", "Connection verified", "Monitoring ready"],
  CUSTOM_SDK: ["Connection registered", "Monitoring ready"],
};

export function ConnectAgentWizard({ atLimit }: { atLimit: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("select");
  const [provider, setProvider] = useState<ConnectorType | null>(null);
  const [credential, setCredential] = useState("");
  const [agentName, setAgentName] = useState("");
  const [candidates, setCandidates] = useState<DiscoveredAgent[]>([]);
  const [connectingLabel, setConnectingLabel] = useState("Connecting…");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<{
    agentSlug: string;
    agentName: string;
    apiKeyRaw?: string;
    apiKeyLimitReached?: boolean;
  } | null>(null);

  function selectProvider(type: ConnectorType) {
    setError(null);
    setProvider(type);
    setStep(type === "CUSTOM_SDK" ? "name" : "credential");
  }

  function submitCredential() {
    if (!provider || provider === "CUSTOM_SDK") return;
    setError(null);
    setConnectingLabel(`Connecting to ${PROVIDERS.find((p) => p.type === provider)?.label}…`);
    startTransition(async () => {
      const result = await discoverConnectionAction({ connectorType: provider, credential });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.agents.length === 0) {
        setStep("name");
        return;
      }
      if (result.agents.length === 1) {
        await finalizeConnect({ selectedExternalId: result.agents[0].externalId });
        return;
      }
      setCandidates(result.agents);
      setStep("choose");
    });
  }

  function chooseAgent(externalId: string) {
    startTransition(async () => {
      await finalizeConnect({ selectedExternalId: externalId });
    });
  }

  function submitName() {
    startTransition(async () => {
      await finalizeConnect({ agentName });
    });
  }

  async function finalizeConnect(extra: { selectedExternalId?: string; agentName?: string }) {
    if (!provider) return;
    setError(null);
    setConnectingLabel("Setting up monitoring…");
    setStep("connecting");

    const result = await connectAgentAction({
      connectorType: provider,
      credential: provider === "CUSTOM_SDK" ? undefined : credential,
      ...extra,
    });

    if (!result.ok) {
      if ("needsSelection" in result) {
        setCandidates(result.agents);
        setStep("choose");
        return;
      }
      setError(result.error);
      // Retry from wherever this call's input came from.
      setStep(extra.agentName !== undefined ? "name" : "credential");
      return;
    }

    setConnected({ agentSlug: result.agentSlug, agentName: result.agentName, apiKeyRaw: result.apiKeyRaw, apiKeyLimitReached: result.apiKeyLimitReached });
    setStep("connected");
  }

  function goBack() {
    setError(null);
    if (step === "credential" || step === "name") setStep("select");
    if (step === "choose") setStep(provider === "CUSTOM_SDK" ? "select" : "credential");
  }

  if (atLimit && step === "select") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="text-sm text-muted-foreground">
          You&rsquo;re at your plan&rsquo;s agent limit. Upgrade to connect another agent.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      {step === "select" && (
        <div>
          <h2 className="text-sm font-semibold text-foreground">Connect an AI agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connect an agent you already run.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {PROVIDERS.map(({ type, label, description, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => selectProvider(type)}
                className="focus-ring flex flex-col items-start rounded-lg border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-muted"
              >
                <Icon className="size-5 text-foreground" aria-hidden="true" />
                <span className="mt-2.5 text-sm font-semibold text-foreground">{label}</span>
                <span className="mt-1 text-xs text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "credential" && provider && provider !== "CUSTOM_SDK" && (
        <div>
          <BackButton onClick={goBack} />
          <h2 className="mt-2 text-sm font-semibold text-foreground">
            Connect {PROVIDERS.find((p) => p.type === provider)?.label}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Securely connect your existing AI agent to Aegis.
          </p>
          {error && (
            <div className="mt-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <div className="mt-4">
            <Label htmlFor="credential">{CREDENTIAL_HELP[provider].label}</Label>
            <Input
              id="credential"
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder={CREDENTIAL_HELP[provider].placeholder}
            />
            <FieldHint>
              Aegis only uses this to verify the connection and, where supported, find your agent. Stored
              encrypted — never shown again after this step.{" "}
              <a href={CREDENTIAL_HELP[provider].href} target="_blank" rel="noreferrer" className="underline">
                Get an API key
              </a>
              .
            </FieldHint>
          </div>
          <div className="mt-5">
            <Button onClick={submitCredential} disabled={isPending || credential.trim().length === 0}>
              {isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      )}

      {step === "name" && provider && (
        <NameStep
          provider={provider}
          name={agentName}
          onNameChange={setAgentName}
          isPending={isPending}
          error={error}
          onBack={goBack}
          onSubmit={submitName}
        />
      )}

      {step === "choose" && (
        <div>
          <BackButton onClick={goBack} />
          <h2 className="mt-2 text-sm font-semibold text-foreground">Choose an agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aegis found more than one. Pick the one to connect.</p>
          {error && (
            <div className="mt-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {candidates.map((agent) => (
              <button
                key={agent.externalId}
                type="button"
                disabled={isPending}
                onClick={() => chooseAgent(agent.externalId)}
                className="focus-ring flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-muted disabled:opacity-50"
              >
                <span className="font-medium text-foreground">{agent.name}</span>
                {agent.model && <span className="text-xs text-muted-foreground">{agent.model}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "connecting" && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">{connectingLabel}</p>
        </div>
      )}

      {step === "connected" && connected && provider && (
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Agent connected</h2>
          </div>
          <p className="mt-1 text-base font-medium text-foreground">{connected.agentName}</p>

          <ul className="mt-4 space-y-1.5">
            {CONNECT_STEPS_LABEL[provider].map((label) => (
              <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>

          {provider === "CUSTOM_SDK" && connected.apiKeyRaw && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <KeyRound className="size-3.5" aria-hidden="true" />
                Your Aegis API key
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Shown once — export it as <code>AEGIS_API_KEY</code> and install the SDK.
              </p>
              <div className="mt-2">
                <CodeBlock code={connected.apiKeyRaw} language="text" />
              </div>
              <div className="mt-3">
                <CodeBlock
                  language="bash"
                  code={[
                    "npm install @aegis/agent-sdk",
                    "",
                    "# in your agent's code",
                    `export AEGIS_API_KEY="${connected.apiKeyRaw}"`,
                  ].join("\n")}
                />
              </div>
            </div>
          )}

          {provider === "CUSTOM_SDK" && connected.apiKeyLimitReached && (
            <div className="mt-5 border-t border-border pt-5">
              <Alert tone="warning">
                Your plan&rsquo;s API key limit is reached, so Aegis couldn&rsquo;t create a dedicated key for this
                agent. Use an existing key from{" "}
                <Link href="/developers/api-keys" className="underline">
                  Developers &gt; API Keys
                </Link>
                .
              </Alert>
            </div>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            {provider === "CUSTOM_SDK"
              ? "Monitoring is ready. Aegis is waiting for the first event from your agent."
              : "Monitoring is ready. Add the Aegis SDK to this agent to start sending activity."}
          </p>

          <div className="mt-5">
            <Button onClick={() => router.push(`/agents/${connected.agentSlug}`)}>View Agent</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" aria-hidden="true" />
      Back
    </button>
  );
}

function NameStep({
  provider,
  name,
  onNameChange,
  isPending,
  error,
  onBack,
  onSubmit,
}: {
  provider: ConnectorType;
  name: string;
  onNameChange: (name: string) => void;
  isPending: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const providerLabel = PROVIDERS.find((p) => p.type === provider)?.label ?? "agent";

  return (
    <div>
      <BackButton onClick={onBack} />
      <h2 className="mt-2 text-sm font-semibold text-foreground">Name this agent</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {provider === "CUSTOM_SDK"
          ? "Aegis can't discover custom agents automatically — give it a name so you can find it later."
          : `${providerLabel} doesn't expose a way to discover this agent automatically — give it a name.`}
      </p>
      {error && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-4">
        <Label htmlFor="agent-name">Agent name</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Sales Agent"
          maxLength={80}
        />
      </div>
      <div className="mt-5">
        <Button onClick={onSubmit} disabled={isPending || name.trim().length < 2}>
          {isPending ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
