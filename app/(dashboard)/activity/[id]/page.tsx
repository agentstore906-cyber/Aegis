import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getActivityEvent } from "@/lib/activity/queries";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { ActivityStatusBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Activity event" };

export default async function ActivityEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organization } = await requireActiveOrganization();
  const { id } = await params;
  const event = await getActivityEvent(organization.id, id);

  if (!event) notFound();

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
          <ActivityStatusBadge status={event.status} />
          <RiskBadge level={event.riskLevel} />
        </div>
      </div>

      {event.errorMessage && <Alert tone="danger">{event.errorMessage}</Alert>}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Event type" value={event.eventType.replaceAll("_", " ")} />
            <Field label="Resource" value={event.resource ?? "—"} />
            <Field label="Duration" value={event.durationMs != null ? `${event.durationMs}ms` : "—"} />
            <Field
              label="Model"
              value={event.modelName ? `${event.modelProvider ?? ""} ${event.modelName}`.trim() : "—"}
            />
            <Field label="Cost" value={event.costCents != null ? formatCurrency(event.costCents) : "—"} />
            <Field label="Trace ID" value={event.traceId ?? "—"} mono />
            <Field label="Parent event" value={event.parentEventId ?? "—"} mono />
            <Field label="Event ID" value={event.id} mono />
          </dl>
        </CardContent>
      </Card>

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
