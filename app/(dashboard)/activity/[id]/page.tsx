import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getActivityEvent } from "@/lib/activity/queries";
import { getEventLineage } from "@/lib/telemetry/lineage";
import { canViewActionGraph } from "@/lib/graph/authorization";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { ActivityStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Activity event" };

const DESTINATION_KIND_LABEL = { HOST: "host", IP: "IP address", EMAIL_DOMAIN: "email domain" } as const;

export default async function ActivityEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const { id } = await params;
  const event = await getActivityEvent(organization.id, id);

  if (!event) notFound();

  const lineage = await getEventLineage(organization.id, event.id);
  const signals = Array.isArray(event.riskSignals) ? (event.riskSignals as { code: string; detail?: unknown }[]) : [];

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/activity"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to activity
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {event.action.replaceAll("_", " ")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/agents/${event.agent.slug}`} className="hover:underline">
              {event.agent.name}
            </Link>{" "}
            · {formatDateTime(event.timestamp)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActivityStatusBadge status={event.status} source={event.source} />
          <RiskBadge level={event.riskLevel} />
        </div>
      </div>

      {event.traceId && canViewActionGraph(role) && (
        <p className="mb-4 text-sm">
          <Link
            href={`/agents/${event.agent.slug}?tab=graph&trace=${encodeURIComponent(event.traceId)}#evt-${event.id}`}
            className="text-foreground hover:underline"
          >
            See this action in its run (action graph) →
          </Link>
        </p>
      )}

      {event.description && <p className="mb-4 text-sm text-muted-foreground">{event.description}</p>}
      {event.errorMessage && <Alert tone="danger">{event.errorMessage}</Alert>}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Event type" value={event.eventType.replaceAll("_", " ")} />
            <Field label="Resource" value={event.resource ?? "—"} />
            <Field label="Tool" value={event.toolName ?? "—"} />
            <Field label="Service" value={event.service ?? "—"} />
            <Field
              label="Destination"
              value={
                event.destination
                  ? `${event.destination}${event.destinationKind ? ` (${DESTINATION_KIND_LABEL[event.destinationKind]})` : ""}`
                  : "—"
              }
            />
            <Field label="Environment" value={event.environment ? event.environment.toLowerCase() : "—"} />
            <Field
              label="Data"
              value={
                event.dataClasses.length > 0 || event.dataSensitivity
                  ? `${event.dataClasses.join(", ") || "unclassified"}${event.dataSensitivity ? ` · ${event.dataSensitivity.toLowerCase()} sensitivity` : ""}`
                  : "—"
              }
            />
            <Field
              label="Volume"
              value={
                event.recordCount != null || event.byteCount != null
                  ? [
                      event.recordCount != null ? `${event.recordCount.toLocaleString()} records` : null,
                      event.byteCount != null ? `${event.byteCount.toLocaleString()} bytes` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "—"
              }
            />
            <Field label="End user (pseudonymized)" value={event.endUserHash ?? "—"} mono />
            <Field label="Outcome" value={event.outcome ? event.outcome.toLowerCase() : event.source === "policy_evaluation" ? "— (decision, not an execution)" : "—"} />
            <Field label="Source" value={event.source} />
            <Field label="Duration" value={event.durationMs != null ? `${event.durationMs}ms` : "—"} />
            <Field
              label="Model"
              value={event.modelName ? `${event.modelProvider ?? ""} ${event.modelName}`.trim() : "—"}
            />
            <Field label="Cost" value={event.costCents != null ? formatCurrency(event.costCents) : "—"} />
            <Field label="Reported occurred at" value={event.occurredAt ? formatDateTime(event.occurredAt) : "—"} />
            <Field label="Received at" value={formatDateTime(event.timestamp)} />
            <Field label="Trace ID" value={event.traceId ?? "—"} mono />
            <Field label="Client event ID" value={event.clientEventId ?? "—"} mono />
            <Field label="Event ID" value={event.id} mono />
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Lineage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {event.evaluationId && (
            <p>
              Executed under decision{" "}
              <Link href={`/policies/evaluations/${event.evaluationId}`} className="font-mono text-xs underline">
                {event.evaluationId}
              </Link>
            </p>
          )}
          {lineage.ancestors.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Parents (root first)</p>
              <ol className="space-y-1">
                {lineage.ancestors.map((ancestor) => (
                  <li key={ancestor.id}>
                    <Link href={`/activity/${ancestor.id}`} className="hover:underline">
                      {ancestor.action}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      · {ancestor.agent.name} · {formatDateTime(ancestor.timestamp)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : event.parentClientEventId ? (
            <p className="text-muted-foreground">
              Parent <span className="font-mono text-xs">{event.parentClientEventId}</span> hasn&rsquo;t been reported
              yet — it will be linked when it arrives.
            </p>
          ) : (
            <p className="text-muted-foreground">No parent event.</p>
          )}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Child events {lineage.childCount > lineage.children.length && `(showing ${lineage.children.length} of ${lineage.childCount})`}
            </p>
            {lineage.children.length > 0 ? (
              <ol className="space-y-1">
                {lineage.children.map((child) => (
                  <li key={child.id}>
                    <Link href={`/activity/${child.id}`} className="hover:underline">
                      {child.action}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">
                      · {child.agent.name} · {formatDateTime(child.timestamp)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">None.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Recorded signals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Deterministic observations recorded when this event was received. Evidence only — not a risk score.
            </p>
            <MetadataView metadata={event.riskSignals} />
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <MetadataView metadata={event.metadata} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
