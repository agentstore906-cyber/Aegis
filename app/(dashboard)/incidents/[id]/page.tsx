import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { IncidentNotFoundError, canManageIncidents, canViewIncidents } from "@/lib/incidents/authorization";
import { getIncidentView } from "@/lib/incidents/service";
import { formatDateTime } from "@/lib/utils";

import { RiskBadge } from "@/components/dashboard/status-badges";
import { AcknowledgeButton, NoteForm, StatusForm } from "@/components/incidents/incident-actions";
import { EvidenceList, IncidentSummaryPanels, IncidentTimeline, StatusBadge } from "@/components/incidents/incident-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization, user, role } = await requireActiveOrganization();
  if (!canViewIncidents(role)) notFound();
  const { id } = await params;

  let view;
  try {
    view = await getIncidentView({ organizationId: organization.id, userId: user.id, role }, id);
  } catch (error) {
    if (error instanceof IncidentNotFoundError) notFound();
    throw error;
  }
  const { incident, reconstruction, activity, evidenceSinceLastChange } = view;
  const canManage = canManageIncidents(role);

  return (
    <div>
      <Link href="/incidents" className="focus-ring mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All incidents
      </Link>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">INC-{incident.number}</span>
            <StatusBadge status={incident.status} />
            <RiskBadge level={reconstruction.severity} />
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{reconstruction.summary.headline}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/agents/${incident.agent.slug}`} className="hover:underline">
              {incident.agent.name}
            </Link>{" "}
            · opened {formatDateTime(incident.openedAt)} {incident.openedVia === "ALERT_TRIGGER" ? "automatically from a security alert" : `by ${incident.openedBy ?? "an operator"}`}
            {incident.traceId && (
              <>
                {" "}
                ·{" "}
                <Link href={`/agents/${incident.agent.slug}?tab=graph&trace=${encodeURIComponent(incident.traceId)}`} className="hover:underline">
                  see the whole run in the action graph
                </Link>
              </>
            )}
          </p>
        </div>
        {canManage && (
          <div className="shrink-0">
            <AcknowledgeButton incidentId={incident.id} acknowledgedBy={incident.acknowledgedBy} />
          </div>
        )}
        {!canManage && incident.acknowledgedBy && <span className="text-xs text-muted-foreground">Acknowledged by {incident.acknowledgedBy}</span>}
      </div>

      <IncidentSummaryPanels reconstruction={reconstruction} evidenceSince={evidenceSinceLastChange} />

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Timeline</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every row is one stored record (or a snapshot kept inside one), in time order. Nothing here is inferred. Open a row for its details and the records it comes from.
        </p>
        <IncidentTimeline items={reconstruction.items} truncated={reconstruction.truncated.items} />
      </section>

      <section id="evidence" className="mt-8 scroll-mt-24">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Evidence ({reconstruction.evidenceCount})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The stored records behind this incident. They are append-only: handling an incident cannot change or remove them. Digest <span className="font-mono">{reconstruction.evidenceDigest.slice(0, 16)}</span>
        </p>
        <EvidenceList evidence={reconstruction.evidence} />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Handling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {canManage ? (
              <>
                <StatusForm incidentId={incident.id} status={incident.status} />
                <NoteForm incidentId={incident.id} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Your role can view incidents but not change them.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {activity.map((a) => (
                <li key={a.id}>
                  <p className="text-foreground">
                    {a.kind === "OPENED" && "Incident opened"}
                    {a.kind === "ACKNOWLEDGED" && "Acknowledged"}
                    {a.kind === "NOTE" && "Note"}
                    {a.kind === "STATUS_CHANGED" && `Status ${a.fromStatus?.replaceAll("_", " ").toLowerCase()} → ${a.toStatus?.replaceAll("_", " ").toLowerCase()}`}
                    <span className="text-muted-foreground"> · {a.actor ?? "someone"} · {formatDateTime(a.createdAt)}</span>
                  </p>
                  {a.note && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{a.note}</p>}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Append-only: entries cannot be edited or removed.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
