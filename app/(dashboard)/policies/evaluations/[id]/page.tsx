import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { getPolicyEvaluation } from "@/lib/policies/repository";
import { formatDateTime } from "@/lib/utils";

import { DecisionBadge } from "@/components/dashboard/status-badges";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";

export const metadata: Metadata = { title: "Policy evaluation" };

export default async function PolicyEvaluationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organization } = await requireActiveOrganization();
  const { id } = await params;
  const evaluation = await getPolicyEvaluation(organization.id, id);

  if (!evaluation) notFound();

  const matchedPolicies =
    (evaluation.matchedPolicySnapshots as unknown as
      | { id: string; name: string; decision: string; priority: number }[]
      | null) ?? [];
  const permission = evaluation.permissionSnapshot as unknown as
    | { id: string; action: string; resource: string; decision: string }
    | null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/policies/evaluations"
        className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to evaluation history
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{evaluation.action}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/agents/${evaluation.agent.slug}`} className="hover:underline">
              {evaluation.agent.name}
            </Link>{" "}
            · {formatDateTime(evaluation.createdAt)}
          </p>
        </div>
        <DecisionBadge decision={evaluation.decision} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reason</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">{evaluation.reason}</p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Resource" value={evaluation.resource ?? "—"} />
            <Field label="Environment" value={evaluation.environment ?? "—"} />
            <Field label="Tool" value={evaluation.tool ?? "—"} />
            <Field label="Risk level" value={evaluation.riskLevel ?? "—"} />
            <Field label="Trace ID" value={evaluation.traceId ?? "—"} mono />
            <Field label="Evaluation ID" value={evaluation.id} mono />
          </dl>
        </CardContent>
      </Card>

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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Matched policies</CardTitle>
        </CardHeader>
        <CardContent>
          {matchedPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies matched this action.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <details className="mt-4 rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-foreground">
          Raw context
        </summary>
        <div className="border-t border-border p-5">
          <MetadataView metadata={evaluation.context} />
        </div>
      </details>
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
