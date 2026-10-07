import type { Metadata } from "next";
import Link from "next/link";
import { PlugZap, ScanSearch } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { hasCapability } from "@/lib/rbac/capabilities";
import { canManageAgents } from "@/lib/agents/authorization";
import { getAgentConnectionSnapshot } from "@/lib/agents/connection-view";
import { getLatestAgentScan } from "@/lib/scanner/agent-scan";
import { scanEligibility } from "@/lib/scanner/agent-scan-model";
import { listScanTargets } from "@/lib/scanner/agent-scan-targets";
import { PageHeader } from "@/components/dashboard/page-header";
import { AgentScanPanel } from "@/components/security/agent-scan-panel";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Free Risk Scanner", robots: { index: false, follow: false } };

const TITLE = "Free Risk Scanner";

/**
 * The one scanner. It scans REAL agents: only agents of this organization that have really connected are offered,
 * and scanning uses the same Scan Agent implementation as the agent's own Security tab. There is no questionnaire,
 * no demo agent and no score.
 */
export default async function FreeRiskScannerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organization, role } = await requireActiveOrganization();
  const raw = await searchParams;
  const selectedSlug = typeof raw.agent === "string" ? raw.agent.slice(0, 120) : null;

  if (!hasCapability(role, "view_security")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={TITLE} />
        <EmptyState icon={ScanSearch} title="Your role can’t view scans." description="Scan findings are limited to members who can view security information." hint="Ask an owner or admin if you need access." />
      </div>
    );
  }

  const { targets, notScannable } = await listScanTargets(organization.id);

  if (targets.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={TITLE} description="Scan a real, connected AI agent." />
        <EmptyState
          eyebrow="Free Risk Scanner"
          icon={PlugZap}
          title="Connect an AI agent first."
          description="Aegis connects to your real agent and verifies it. Once it has, the agent appears here and you can scan it."
          hint={
            notScannable > 0
              ? `${notScannable} ${notScannable === 1 ? "agent was" : "agents were"} not connected through ${notScannable === 1 ? "its" : "their"} endpoint, or ${notScannable === 1 ? "is" : "are"} disconnected, so ${notScannable === 1 ? "it" : "they"} can’t be scanned.`
              : "Nothing is scanned from a name or a questionnaire."
          }
          action={<ButtonLink href="/agents/new">Connect Agent</ButtonLink>}
        />
      </div>
    );
  }

  // The selected agent must be one of this organization's connected agents; anything else is ignored or explained.
  const selected = selectedSlug ? (targets.find((t) => t.slug === selectedSlug) ?? null) : null;
  let unavailable: { name: string; reason: string } | null = null;
  if (selectedSlug && !selected) {
    const snap = await getAgentConnectionSnapshot(organization.id, selectedSlug);
    if (snap) {
      const e = scanEligibility({ state: snap.view.state, connectorType: snap.connectorType, firstHandshakeAt: snap.view.firstHandshakeAt });
      unavailable = { name: snap.agent.name, reason: e.ok ? "This agent can’t be scanned right now." : e.message };
    }
  }
  const latest = selected ? await getLatestAgentScan(organization.id, selected.id) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={TITLE} description="Choose a connected agent and scan it. Aegis verifies the agent live; findings are what it observed and tested — there is no score." />

      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {targets.map((t) => (
          <li key={t.id} className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", selected?.id === t.id && "bg-surface-muted")}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {t.stateLabel}
                {t.lastSeenAt ? ` · last seen ${formatDateTime(t.lastSeenAt)}` : ""}
                {" · "}
                {t.lastScan ? `scanned ${formatDateTime(t.lastScan.at)}` : "not scanned yet"}
              </p>
            </div>
            <ButtonLink href={`/risk-scan?agent=${encodeURIComponent(t.slug)}#scan`} variant={selected?.id === t.id ? "secondary" : "primary"} size="sm">
              {t.lastScan ? "View scan" : "Scan Agent"}
            </ButtonLink>
          </li>
        ))}
      </ul>
      {notScannable > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {notScannable} other {notScannable === 1 ? "agent was" : "agents were"} not connected through {notScannable === 1 ? "its" : "their"} endpoint, or {notScannable === 1 ? "is" : "are"} disconnected, so can’t be scanned.{" "}
          <Link href="/agents" className="underline">
            View agents
          </Link>
        </p>
      )}

      {unavailable && (
        <p role="note" className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{unavailable.name}:</span> {unavailable.reason}
        </p>
      )}

      {selected && (
        <div className="mt-6">
          <AgentScanPanel
            slug={selected.slug}
            agentName={selected.name}
            connectionLabel={selected.stateLabel}
            alertsHref={`/agents/${selected.slug}?tab=security`}
            canScan={canManageAgents(role)}
            blockedReason={null}
            scan={latest ? { createdAtIso: latest.createdAt.toISOString(), result: latest.result } : null}
          />
        </div>
      )}
    </div>
  );
}
