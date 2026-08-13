import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getAuditEvent } from "@/lib/audit/repository";
import { formatDateTime } from "@/lib/utils";

import { AuditResultBadge } from "@/components/dashboard/status-badges";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";

export const metadata: Metadata = { title: "Audit event" };

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization } = await requireActiveOrganization();
  const { id } = await params;
  const event = await getAuditEvent(organization.id, id);

  if (!event) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/audit"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to audit trail
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{event.eventType}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateTime(event.createdAt)}</p>
        </div>
        <AuditResultBadge result={event.result} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field
              label="Actor"
              value={
                event.actorType === "USER"
                  ? event.actorUser?.name ?? event.actorUser?.email ?? "Unknown user"
                  : event.actorType === "SYSTEM"
                    ? "Aegis (system)"
                    : "Agent"
              }
            />
            <Field label="Organization" value={organization.name} />
            <Field label="Entity" value={`${event.entityType} · ${event.entityId}`} mono />
            <Field label="Action" value={event.action} mono />
            {event.agent && (
              <Field
                label="Related agent"
                value={<Link href={`/agents/${event.agent.slug}`} className="hover:underline">{event.agent.name}</Link>}
              />
            )}
            <Field label="Trace ID" value={event.traceId ?? "—"} mono />
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

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
