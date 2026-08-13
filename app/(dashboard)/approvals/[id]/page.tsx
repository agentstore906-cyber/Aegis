import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getApprovalRequest, listApprovalsForAgent } from "@/lib/approvals/repository";
import { canResolveApproval } from "@/lib/approvals/authorization";
import { getActivityByTraceId } from "@/lib/activity/queries";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

import { ApprovalStatusBadge, RiskBadge, ActivityStatusBadge } from "@/components/dashboard/status-badges";
import { ApprovalResolutionForm } from "@/components/approvals/approval-resolution-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Approval request" };

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organization, role } = await requireActiveOrganization();
  const { id } = await params;

  const request = await getApprovalRequest(organization.id, id);
  if (!request) notFound();

  const [relatedActivity, agentHistory] = await Promise.all([
    request.traceId ? getActivityByTraceId(organization.id, request.traceId) : Promise.resolve([]),
    listApprovalsForAgent(organization.id, request.agentId, 6),
  ]);

  const matchedPolicies =
    (request.policyEvaluation?.matchedPolicySnapshots as unknown as
      | { id: string; name: string; decision: string; priority: number }[]
      | null) ?? [];
  const permission = request.policyEvaluation?.permissionSnapshot as unknown as
    | { id: string; action: string; resource: string; decision: string }
    | null;

  const otherAgentRequests = agentHistory.filter((r) => r.id !== request.id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/approvals"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to approvals
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approval {request.status === "PENDING" ? "required" : request.status.toLowerCase()}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            <Link href={`/agents/${request.agent.slug}`} className="hover:underline">
              {request.agent.name}
            </Link>
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{request.action}</p>
        </div>
        <ApprovalStatusBadge status={request.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Resource" value={request.resource ?? "—"} />
            <Field label="Environment" value={request.environment ?? "—"} />
            <Field label="Tool" value={request.tool ?? "—"} />
            <Field label="Risk" value={request.riskLevel ? <RiskBadge level={request.riskLevel} /> : "—"} />
            <Field label="Requested" value={`${formatRelativeTime(request.requestedAt)} · ${formatDateTime(request.requestedAt)}`} />
            <Field label="Policy result" value="REQUIRE APPROVAL" />
            {request.expiresAt && <Field label="Expires" value={formatDateTime(request.expiresAt)} />}
            {request.resolvedAt && <Field label="Resolved" value={formatDateTime(request.resolvedAt)} />}
          </dl>

          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Triggered by
            </p>
            <p className="text-sm text-foreground">{request.reason}</p>
          </div>
        </CardContent>
      </Card>

      {request.context != null && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Context</CardTitle>
          </CardHeader>
          <CardContent>
            <MetadataView metadata={request.context} />
          </CardContent>
        </Card>
      )}

      {permission && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Baseline permission</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs text-foreground">
              {permission.action} ({permission.resource || "any resource"}) → {permission.decision}
            </p>
          </CardContent>
        </Card>
      )}

      {matchedPolicies.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Matched policies</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {matchedPolicies.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <Link href={`/policies/${p.id}/edit`} className="text-foreground hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {p.decision.replaceAll("_", " ")} · priority {p.priority}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {request.decisions.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {request.decisions.map((decision) => (
                <li key={decision.id} className="text-sm">
                  <p className="text-foreground">
                    <span className="font-medium">{decision.decision === "APPROVED" ? "Approved" : "Rejected"}</span>{" "}
                    by {decision.decidedBy.name ?? decision.decidedBy.email} ·{" "}
                    <span className="text-muted-foreground">{formatDateTime(decision.createdAt)}</span>
                  </p>
                  {decision.comment && <p className="mt-1 text-muted-foreground">&ldquo;{decision.comment}&rdquo;</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {request.status === "PENDING" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Review</CardTitle>
          </CardHeader>
          <CardContent>
            {canResolveApproval(role) ? (
              <ApprovalResolutionForm requestId={request.id} />
            ) : (
              <Alert tone="info">
                Only Owners, Admins, and Security members can approve or reject this request.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {request.status === "APPROVED" && (
        <Alert tone="success">Approved — ready for execution. Aegis records the decision; resuming the agent&rsquo;s action happens outside Aegis today.</Alert>
      )}

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
                  <ActivityStatusBadge status={event.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {otherAgentRequests.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Previous approvals from {request.agent.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {otherAgentRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/approvals/${r.id}`} className="min-w-0 truncate font-mono text-xs text-foreground hover:underline">
                    {r.action}
                  </Link>
                  <ApprovalStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <details className="mt-4 rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-foreground">
          Trace &amp; identifiers
        </summary>
        <div className="border-t border-border p-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Trace ID" value={request.traceId ?? "—"} mono />
            <Field label="Approval request ID" value={request.id} mono />
            <Field
              label="Policy evaluation"
              value={
                request.policyEvaluation ? (
                  <Link href={`/policies/evaluations/${request.policyEvaluation.id}`} className="hover:underline">
                    View evaluation
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </div>
      </details>
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
