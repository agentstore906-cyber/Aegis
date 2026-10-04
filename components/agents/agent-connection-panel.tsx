"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Unplug, ShieldCheck } from "lucide-react";
import type { ConnectorType, ConnectionStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectionStatusBadge } from "@/components/dashboard/status-badges";
import {
  checkConnectionHealthAction,
  reconnectAgentAction,
  disconnectAgentAction,
} from "@/lib/agents/connect-actions";
import type { ConnectorCapabilities } from "@/lib/connectors/types";
import { ConnectionCredential } from "@/components/agents/connection/connection-credential";
import { ConnectionInstructions } from "@/components/agents/connection/connection-instructions";

const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  CUSTOM_SDK: "Custom Agent (Aegis SDK)",
};

const CAPABILITY_LABELS: Record<keyof ConnectorCapabilities, string> = {
  agentDiscovery: "Agent discovery",
  activityMonitoring: "Activity monitoring",
  usageMonitoring: "Usage sync",
  costMonitoring: "Cost sync",
  pauseAgent: "Pause agent",
  killSwitch: "Kill switch",
  credentialVerification: "Credential verification",
};

const NEEDS_CREDENTIAL: ConnectorType[] = ["OPENAI", "ANTHROPIC"];

export function AgentConnectionPanel({
  agentSlug,
  connectorType,
  status,
  externalAccountLabel,
  capabilities,
  connectedAtLabel,
  lastVerifiedAtLabel,
  lastHealthCheckAtLabel,
  lastHealthError,
  canManage,
  derived,
}: {
  agentSlug: string;
  connectorType: ConnectorType;
  status: ConnectionStatus;
  externalAccountLabel: string | null;
  capabilities: ConnectorCapabilities;
  connectedAtLabel: string;
  lastVerifiedAtLabel: string | null;
  lastHealthCheckAtLabel: string | null;
  lastHealthError: string | null;
  canManage: boolean;
  /** The evidence-based state (lib/agents/connection-state.ts). When present it replaces the raw stored status. */
  derived?: { state: string; stateLabel: string; detail: string; reason: string | null; lastSeenLabel: string | null };
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showReconnectForm, setShowReconnectForm] = useState(false);
  const [reconnectCredential, setReconnectCredential] = useState("");
  // A freshly issued credential (Aegis-key connections). Shown once, here, because it is not stored anywhere readable.
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const isDisconnected = status === "DISCONNECTED";
  const needsReconnect = status === "RECONNECT_REQUIRED" || status === "DEGRADED" || status === "FAILED";
  const requiresCredentialToReconnect = NEEDS_CREDENTIAL.includes(connectorType);

  function checkHealth() {
    setError(null);
    startTransition(async () => {
      const result = await checkConnectionHealthAction(agentSlug);
      if (!result.ok) setError(result.error ?? "The connection couldn't be verified.");
    });
  }

  function reconnect() {
    setError(null);
    startTransition(async () => {
      const result = await reconnectAgentAction(agentSlug, { credential: reconnectCredential || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setShowReconnectForm(false);
      setReconnectCredential("");
      if ("apiKeyRaw" in result && result.apiKeyRaw) setIssuedKey(result.apiKeyRaw);
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectAgentAction(agentSlug);
      if (result.error) setError(result.error);
    });
  }

  const trueCapabilities = (Object.keys(capabilities) as (keyof ConnectorCapabilities)[]).filter(
    (key) => capabilities[key]
  );

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Connection</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{CONNECTOR_LABELS[connectorType]}</p>
        </div>
        {derived ? (
          <Badge tone={derived.state === "CONNECTED" ? "success" : derived.state === "ERROR" || derived.state === "REVOKED" ? "danger" : derived.state === "NOT_SEEN_RECENTLY" ? "warning" : "neutral"} dot>
            {derived.stateLabel}
          </Badge>
        ) : (
          <ConnectionStatusBadge status={status} />
        )}
      </div>

      <div className="space-y-3 px-5 py-4 text-sm">
        {externalAccountLabel && (
          <Row label="Account" value={<code className="text-xs">{externalAccountLabel}</code>} />
        )}
        {derived && <p className="text-xs text-muted-foreground">{derived.reason ?? derived.detail}</p>}
        {derived?.lastSeenLabel && <Row label="Last seen" value={derived.lastSeenLabel} />}
        <Row label="Connection created" value={connectedAtLabel} />
        {lastVerifiedAtLabel && <Row label="Last verified" value={lastVerifiedAtLabel} />}
        {lastHealthCheckAtLabel && <Row label="Last checked" value={lastHealthCheckAtLabel} />}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {trueCapabilities.map((key) => (
            <Badge key={key} tone="neutral">
              {CAPABILITY_LABELS[key]}
            </Badge>
          ))}
        </div>
      </div>

      {lastHealthError && (
        <div className="px-5 pb-4">
          <Alert tone="warning">{lastHealthError}</Alert>
        </div>
      )}

      {needsReconnect && !isDisconnected && (
        <div className="px-5 pb-4">
          <Alert tone="warning">Connection needs to be renewed.</Alert>
        </div>
      )}

      {error && (
        <div className="px-5 pb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {issuedKey && (
        <div className="space-y-4 border-t border-border px-5 py-4">
          <p className="text-sm font-medium text-foreground">New credential issued. The previous one no longer works.</p>
          <ConnectionCredential secret={issuedKey} />
          <ConnectionInstructions />
          <p className="text-xs text-muted-foreground">The agent shows as waiting until a request with this credential reaches Aegis.</p>
        </div>
      )}

      {showReconnectForm && requiresCredentialToReconnect && (
        <div className="border-t border-border px-5 py-4">
          <Label htmlFor="reconnect-credential">New API key</Label>
          <Input
            id="reconnect-credential"
            type="password"
            autoComplete="off"
            value={reconnectCredential}
            onChange={(e) => setReconnectCredential(e.target.value)}
            placeholder="sk-..."
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={isPending || reconnectCredential.trim().length === 0} onClick={reconnect}>
              {isPending ? "Reconnecting…" : "Reconnect"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReconnectForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {!isDisconnected && (
            <Button variant="secondary" size="sm" disabled={isPending} onClick={checkHealth}>
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {isPending ? "Checking…" : "Check connection"}
            </Button>
          )}

          {!showReconnectForm && (
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={() => (requiresCredentialToReconnect ? setShowReconnectForm(true) : reconnect())}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {isPending && !showReconnectForm ? "Reconnecting…" : "Reconnect"}
            </Button>
          )}

          {!isDisconnected && (
            <ConfirmDialog
              title="Disconnect agent"
              description="Aegis revokes this agent's credential immediately. Requests that use it are rejected and the agent shows as Revoked. Activity, decisions and audit history are kept. You can reconnect later; that issues a new credential for the same agent."
              confirmLabel="Disconnect"
              onConfirm={disconnect}
              trigger={
                <Button variant="destructive" size="sm" type="button" disabled={isPending}>
                  <Unplug className="size-3.5" aria-hidden="true" />
                  Disconnect
                </Button>
              }
            />
          )}
        </div>
      )}

      {isDisconnected && (
        <div className="px-5 pb-3 text-xs text-muted-foreground">
          This connection was disconnected. Historical activity is preserved.
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
