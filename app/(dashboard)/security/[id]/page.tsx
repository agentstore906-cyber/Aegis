import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getSecurityAlert, listAlertOccurrences, listSecurityAlertsForAgent } from "@/lib/security/repository";
import { canManageAgents } from "@/lib/agents/authorization";
import { getActivityByTraceId } from "@/lib/activity/queries";
import { getPolicyEvaluationsByTraceId } from "@/lib/policies/repository";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

import {
  SecurityAlertSeverityBadge,
  SecurityAlertStatusBadge,
  ActivityStatusBadge,
  DecisionBadge,
} from "@/components/dashboard/status-badges";
import { SecurityAlertActions } from "@/components/security/security-alert-actions";
import { AgentStatusToggle } from "@/components/agents/agent-status-toggle";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";
import { ButtonLink } from "@/components/ui/button";
import { OpenIncidentButton } from "@/components/incidents/incident-actions";
import { canManageIncidents } from "@/lib/incidents/authorization";

export const metadata: Metadata = { title: "Security alert" };

export default async function SecurityAlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization, role } = await requireActiveOrganization();
  const { id } = await params;

  const alert = await getSecurityAlert(organization.id, id);
  if (!alert) notFound();

  const [relatedActivity, relatedEvaluations, agentHistory, occurrenceHistory] = await Promise.all([
    alert.traceId ? getActivityByTraceId(organization.id, alert.traceId) : Promise.resolve([]),
    alert.traceId ? getPolicyEvaluationsByTraceId(organization.id, alert.traceId) : Promise.resolve([]),
    listSecurityAlertsForAgent(organization.id, alert.agentId, 6),
    listAlertOccurrences(organization.id, alert.id),
  ]);

  const otherAgentAlerts = agentHistory.filter((a) => a.id !== alert.id);

  const createPolicyHref = `/policies/new?${new URLSearchParams({
    name: `Block after: ${alert.title}`,
    action: (alert.evidence as { action?: string } | null)?.action ?? "",
    agentId: alert.agentId,
    decision: "BLOCK",
    severity: alert.severity,
  }).toString()}`;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/security"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to security
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{alert.type.replaceAll("_", " ")}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{alert.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/agents/${alert.agent.slug}`} className="hover:underline">
              {alert.agent.name}
            </Link>{" "}
            · First seen {formatRelativeTime(alert.firstSeenAt)}
            {alert.count > 1 && ` · seen ${alert.count} times`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SecurityAlertSeverityBadge severity={alert.severity} />
          <SecurityAlertStatusBadge status={alert.status} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What happened</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-foreground">{alert.description}</p>
          {alert.confidence && (
            <p className="text-xs text-muted-foreground">
              Confidence: <span className="font-medium text-foreground">{alert.confidence.toLowerCase()}</span> — this
              is a heuristic indicator, not a confirmed finding.
            </p>
          )}
          {alert.recommendedAction && (
            <div className="rounded-md border border-border bg-surface-muted px-3.5 py-2.5">
              <p className="text-sm font-medium text-muted-foreground">Recommended action</p>
              <p className="mt-0.5 text-sm text-foreground">{alert.recommendedAction}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Evidence (first occurrence)</CardTitle>
        </CardHeader>
        <CardContent>
          <MetadataView metadata={alert.evidence} />
        </CardContent>
      </Card>

      {occurrenceHistory.total > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>
              Occurrences ({occurrenceHistory.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Every time this was detected, with its own evidence — repeats are grouped into this alert, never
              overwritten.
              {occurrenceHistory.total > occurrenceHistory.occurrences.length &&
                ` Showing the ${occurrenceHistory.occurrences.length} most recent.`}
            </p>
            <ol className="space-y-3">
              {occurrenceHistory.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SecurityAlertSeverityBadge severity={occurrence.severity} />
                    <span>{formatDateTime(occurrence.occurredAt)}</span>
                    {occurrence.traceId && <span className="font-mono">trace {occurrence.traceId}</span>}
                  </div>
                  <MetadataView metadata={occurrence.evidence} />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="First seen" value={formatDateTime(alert.firstSeenAt)} />
            <Field label="Last seen" value={formatDateTime(alert.lastSeenAt)} />
            {alert.acknowledgedAt && (
              <Field
                label="Acknowledged"
                value={`${formatDateTime(alert.acknowledgedAt)}${alert.acknowledgedByUser ? ` by ${alert.acknowledgedByUser.name ?? alert.acknowledgedByUser.email}` : ""}`}
              />
            )}
            {alert.resolvedAt && (
              <Field
                label="Resolved"
                value={`${formatDateTime(alert.resolvedAt)}${alert.resolvedByUser ? ` by ${alert.resolvedByUser.name ?? alert.resolvedByUser.email}` : ""}`}
              />
            )}
            <Field label="Trace ID" value={alert.traceId ?? "—"} mono />
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Investigate & respond</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecurityAlertActions id={alert.id} status={alert.status} />
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <ButtonLink href={`/agents/${alert.agent.slug}`} variant="secondary" size="sm">
              View agent
            </ButtonLink>
            <ButtonLink href={`/activity?agentId=${alert.agentId}`} variant="secondary" size="sm">
              View activity
            </ButtonLink>
            <ButtonLink href={createPolicyHref} variant="secondary" size="sm">
              Create policy from alert
            </ButtonLink>
            {canManageIncidents(role) && <OpenIncidentButton anchorType="SECURITY_ALERT" anchorId={alert.id} />}
            {canManageAgents(role) && <AgentStatusToggle slug={alert.agent.slug} status={alert.agent.status} />}
          </div>
          <p className="text-xs text-muted-foreground">
            &ldquo;Create policy from alert&rdquo; pre-fills a new policy — it doesn&rsquo;t create one automatically.
            Pausing an agent takes effect immediately.
          </p>
        </CardContent>
      </Card>

      {relatedActivity.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Related activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {relatedActivity.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{event.action.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(event.timestamp)}</p>
                  </div>
                  <ActivityStatusBadge status={event.status} source={event.source} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {relatedEvaluations.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Related policy evaluations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {relatedEvaluations.map((evaluation) => (
                <li key={evaluation.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link
                    href={`/policies/evaluations/${evaluation.id}`}
                    className="min-w-0 truncate font-mono text-xs text-foreground hover:underline"
                  >
                    {evaluation.action}
                  </Link>
                  <DecisionBadge decision={evaluation.decision} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {otherAgentAlerts.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Other alerts for {alert.agent.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {otherAgentAlerts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/security/${a.id}`} className="min-w-0 truncate text-foreground hover:underline">
                    {a.title}
                  </Link>
                  <SecurityAlertStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
