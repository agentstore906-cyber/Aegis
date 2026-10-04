import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ScanSearch } from "lucide-react";

import { canManageAgents } from "@/lib/agents/authorization";
import { listAllAgentsForOrg } from "@/lib/agents/queries";
import { requireActiveOrganization } from "@/lib/organizations/queries";
import { hasCapability } from "@/lib/rbac/capabilities";
import { trackScannerEvent } from "@/lib/scanner/analytics";
import { getOrganizationScan } from "@/lib/scanner/service";
import { AegisSetup } from "@/components/scanner/aegis-setup";
import { LinkAgentForm } from "@/components/scanner/link-agent-form";
import { agentTypeLabel, ScanReport } from "@/components/scanner/report";
import { SharePanel } from "@/components/scanner/share-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { Panel } from "@/components/console/primitives";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Risk scan", robots: { index: false, follow: false } };

export default async function RiskScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization, role } = await requireActiveOrganization();

  if (!hasCapability(role, "view_security")) {
    return <EmptyState icon={ScanSearch} title="Your role can’t view risk scans." description="Risk scans are limited to members who can view security information." />;
  }

  const scan = await getOrganizationScan(organization.id, id);
  if (!scan) notFound();

  const canLink = canManageAgents(role);
  const agents = canLink ? await listAllAgentsForOrg(organization.id) : [];
  const linked = scan.connectedAgentId ? agents.find((a) => a.id === scan.connectedAgentId) : undefined;
  await trackScannerEvent("report_viewed", { organizationId: organization.id, scanId: scan.id, properties: { source: "dashboard", level: scan.result.level } });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/risk-scan" className="focus-ring mb-3 inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden="true" />
          All risk scans
        </Link>
        <PageHeader
          title="Risk scan"
          description="Detected risks and the Aegis controls that answer them."
          action={
            <ButtonLink href="/scan?from=dashboard" variant="secondary">
              <ScanSearch className="size-4" aria-hidden="true" />
              Run a new AI Agent Risk Scan
            </ButtonLink>
          }
        />
      </div>

      <AegisSetup result={scan.result} />

      <Panel label="Connect this scan to an agent">
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canLink ? (
              <>
                No agents in this workspace yet. <Link href="/agents/new" className="font-medium text-foreground underline underline-offset-2">Register an agent</Link>, then link this scan to it.
              </>
            ) : (
              "Ask an owner or admin to register an agent and link this scan."
            )}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {linked ? <>Linked to <span className="font-medium text-foreground">{linked.name}</span>.</> : "Linking is a record only: it doesn’t change the agent or enforce anything."}
            </p>
            <LinkAgentForm scanId={scan.id} agents={agents.map((a) => ({ id: a.id, name: a.name }))} currentAgentId={scan.connectedAgentId} />
          </>
        )}
      </Panel>

      <ScanReport result={scan.result} agentLabel={agentTypeLabel(scan.agentType, scan.agentLabel)} createdAt={scan.createdAt} />

      <SharePanel scanId={scan.id} score={scan.result.score} highRisk={scan.result.counts.high} initialPath={scan.isPublic && scan.publicSlug ? `/scan/r/${scan.publicSlug}` : null} />
    </div>
  );
}
