import Link from "next/link";

import { ActivityStatusBadge, ApprovalStatusBadge, DecisionBadge, RiskBadge } from "@/components/dashboard/status-badges";
import { Badge } from "@/components/ui/badge";
import { MetadataView } from "@/components/activity/metadata-view";
import { chainFor } from "@/lib/graph/chain";
import type { ItemFlag, ParentStatus, TimelineItem } from "@/lib/graph/types";
import { formatDateTime } from "@/lib/utils";

/**
 * The timeline: one row per action, nested under the action that caused it,
 * in the order Aegis received them. Each row expands (native <details>, so it
 * works without client JavaScript) to its observable context, decision, risk,
 * approval and links. No reasoning is ever shown — see lib/graph/sanitize.ts.
 */

const FLAG_LABEL: Record<ItemFlag, { text: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  blocked: { text: "Blocked decision", tone: "danger" },
  approval_required: { text: "Approval required", tone: "warning" },
  approval_pending: { text: "Approval pending", tone: "warning" },
  risk_gated: { text: "Gated by risk control", tone: "info" },
  executed_despite_decision: { text: "Reported executed despite decision", tone: "danger" },
  high_risk: { text: "High risk", tone: "warning" },
  behavioral_deviation: { text: "Unusual for this agent", tone: "info" },
};

const PARENT_NOTE: Partial<Record<ParentStatus, string>> = {
  awaiting_parent: "Names a parent event that Aegis has not received (yet).",
  outside_page: "Its parent is in this run, on another page of the timeline.",
  unavailable: "Its parent is not available in this run.",
  cycle: "Its parent chain loops back on itself; shown here so nothing is hidden.",
};

const MAX_INDENT = 8;

function offset(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

type Props = { items: TimelineItem[]; agentName: string; agentSlug: string; traceId: string; runStart: Date };

export function ActionTimeline({ items, agentName, agentSlug, traceId, runStart }: Props) {
  return (
    <ol className="space-y-1.5">
      {items.map((item) => (
        <TimelineRow key={item.id} item={item} agentName={agentName} agentSlug={agentSlug} traceId={traceId} runStart={runStart} />
      ))}
    </ol>
  );
}

function TimelineRow({ item, agentName, agentSlug, traceId, runStart }: Omit<Props, "items"> & { item: TimelineItem }) {
  const e = item.event;
  const d = e.decision;
  const indent = Math.min(item.depth, MAX_INDENT);
  const note = PARENT_NOTE[item.parent.status];
  const attention = item.flags.some((f) => f === "blocked" || f === "executed_despite_decision");

  return (
    <li id={`evt-${item.id}`} className="scroll-mt-24">
      <details className={`rounded-md border bg-surface ${attention ? "border-danger-border" : "border-border"}`} style={{ marginLeft: `${indent * 16}px` }}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
          <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-muted-foreground" title={e.timestamp.toISOString()}>
            {offset(e.timestamp.getTime() - runStart.getTime())}
          </span>
          <span className="font-medium text-foreground">{e.action.replaceAll("_", " ")}</span>
          {e.source === "policy_evaluation" ? <Badge tone="info">decision</Badge> : <Badge tone="neutral">reported</Badge>}
          <ActivityStatusBadge status={e.status as never} source={e.source} />
          {d && <DecisionBadge decision={d.decision as never} />}
          <RiskBadge level={e.riskLevel as never} />
          {e.toolName && <span className="text-xs text-muted-foreground">via {e.toolName}</span>}
          {(e.destination ?? e.service) && <span className="text-xs text-muted-foreground">→ {e.destination ?? e.service}</span>}
          {item.flags.map((flag) => (
            <Badge key={flag} tone={FLAG_LABEL[flag].tone}>
              {FLAG_LABEL[flag].text}
            </Badge>
          ))}
          {item.children.length > 0 && <span className="text-xs text-muted-foreground">{item.children.length} follow-on</span>}
        </summary>

        <div className="space-y-4 border-t border-border px-4 py-3 text-sm">
          {note && <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">{note}</p>}

          <div className="flex flex-wrap items-center gap-1 text-xs">
            {chainFor(e, agentName, traceId).map((step, i, all) => (
              <span key={`${step.kind}-${i}`} className="inline-flex items-center gap-1">
                <span className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-foreground">
                  <span className="text-muted-foreground">{step.kind.toLowerCase()}: </span>
                  {step.label}
                </span>
                {i < all.length - 1 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
              </span>
            ))}
          </div>

          <Section title="Context">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Field label="Received" value={formatDateTime(e.timestamp)} />
              {e.occurredAt && Math.abs(e.occurredAt.getTime() - e.timestamp.getTime()) > 1000 && (
                <Field label="Agent says it happened" value={formatDateTime(e.occurredAt)} />
              )}
              <Field label="Type" value={e.eventType.replaceAll("_", " ").toLowerCase()} />
              <Field label="Resource" value={e.resource} />
              <Field label="Tool" value={e.toolName ?? e.toolKey} />
              <Field label="Service" value={e.service} />
              <Field label="Destination" value={e.destination ? `${e.destination}${e.destinationKind ? ` (${e.destinationKind.toLowerCase()})` : ""}` : null} />
              <Field label="Data" value={e.dataClasses.length ? `${e.dataClasses.join(", ")}${e.dataSensitivity ? ` · ${e.dataSensitivity.toLowerCase()} sensitivity` : ""}` : null} />
              <Field label="Volume" value={e.recordCount !== null || e.byteCount !== null ? [e.recordCount !== null ? `${e.recordCount.toLocaleString("en-US")} records` : null, e.byteCount !== null ? `${e.byteCount.toLocaleString("en-US")} bytes` : null].filter(Boolean).join(", ") : null} />
              <Field label="Task" value={e.taskId ? `${e.taskId}${e.taskType ? ` (${e.taskType})` : ""}` : null} />
              <Field label="End user" value={e.endUserHash ? `${e.endUserHash.slice(0, 12)} (pseudonym)` : null} />
              <Field label="Reported outcome" value={e.outcome?.toLowerCase() ?? null} />
              <Field label="Duration" value={e.durationMs !== null ? `${e.durationMs.toLocaleString("en-US")} ms` : null} />
              <Field label="Event id" value={e.id} mono />
              <Field label="Decision id (execution identifier)" value={d?.evaluationId ?? e.evaluationId} mono />
            </dl>
            {e.description && <p className="mt-2 text-xs text-muted-foreground">Summary reported by the agent: {e.description}</p>}
            {e.errorMessage && <p className="mt-1 text-xs text-danger">Error reported: {e.errorMessage}</p>}
          </Section>

          {d && (
            <Section title="Decision and policy">
              <p className="text-foreground">{d.reason}</p>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <Field label="Decided by" value={d.decisionSource?.replaceAll("_", " ").toLowerCase() ?? null} />
                <Field label="Policies alone said" value={d.policyDecision?.replaceAll("_", " ").toLowerCase() ?? null} />
                <Field label="Matched policies" value={d.matchedPolicies.length ? d.matchedPolicies.map((p) => `${p.name} (${p.decision.toLowerCase().replaceAll("_", " ")})`).join(", ") : "none"} />
                <Field label="Agent permission" value={d.permission ? `${d.permission.action} → ${d.permission.decision.toLowerCase().replaceAll("_", " ")}` : null} />
                <Field label="Risk assessed" value={d.riskLevel?.toLowerCase() ?? null} />
                <Field label="Risk engine recommended" value={d.riskRecommended?.replaceAll("_", " ").toLowerCase() ?? null} />
                <Field label="Risk control" value={d.riskControlOutcome ? `${d.riskControlOutcome.replaceAll("_", " ").toLowerCase()}${d.riskControlMode ? ` (${d.riskControlMode.replaceAll("_", " ").toLowerCase()})` : ""}` : null} />
                <Field label="Agent trust then" value={d.trust ? `${d.trust.state.replaceAll("_", " ").toLowerCase()} (${d.trust.score}/100)` : null} />
              </dl>
              {d.approval && (
                <p className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Approval:</span>
                  <ApprovalStatusBadge status={d.approval.status as never} />
                  <Link href={`/approvals/${d.approval.id}`} className="text-foreground hover:underline">
                    Open request
                  </Link>
                </p>
              )}
              {d.consumedApprovalRequestId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This decision used up approval{" "}
                  <Link href={`/approvals/${d.consumedApprovalRequestId}`} className="text-foreground hover:underline">
                    {d.consumedApprovalRequestId}
                  </Link>
                  .
                </p>
              )}
              <p className="mt-2 text-xs">
                <Link href={`/policies/evaluations/${d.evaluationId}`} className="text-foreground hover:underline">
                  Full evaluation and risk assessment
                </Link>
              </p>
            </Section>
          )}

          {e.ranUnder && (
            <Section title="Ran under decision">
              <p className="flex items-center gap-2 text-xs">
                <DecisionBadge decision={e.ranUnder.decision as never} />
                <Link href={`/policies/evaluations/${e.ranUnder.evaluationId}`} className="text-foreground hover:underline">
                  View decision
                </Link>
              </p>
              {item.flags.includes("executed_despite_decision") && (
                <p className="mt-1 text-xs text-danger">
                  The agent reported this action as completed although the decision was {e.ranUnder.decision.replaceAll("_", " ").toLowerCase()}. Aegis returns decisions; it cannot stop an integration that does not honor them.
                </p>
              )}
            </Section>
          )}

          {(e.signals.length > 0 || (d && d.riskSignals.length > 0)) && (
            <Section title="Risk signals">
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground">
                {d?.riskSignals.map((s) => (
                  <li key={`${s.family}-${s.code}`}>
                    {s.code.replaceAll("_", " ")} <span className="text-muted-foreground">({s.severity.toLowerCase()} · {s.family})</span>
                  </li>
                ))}
                {e.signals.map((s, i) => (
                  <li key={`${s.code}-${i}`}>{s.code.replaceAll("_", " ")} <span className="text-muted-foreground">(observed at ingest)</span></li>
                ))}
              </ul>
            </Section>
          )}

          {e.deviations.length > 0 && (
            <Section title="Unusual for this agent">
              <ul className="space-y-1 text-xs text-foreground">
                {e.deviations.map((dev, i) => (
                  <li key={`${dev.kind}-${i}`}>
                    <span className="font-medium">{dev.kind.replaceAll("_", " ").toLowerCase()}</span> <span className="text-muted-foreground">({dev.confidence.toLowerCase()} confidence)</span>: {dev.explanation}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Reported context">
            {e.contextWithheld && (
              <p className="mb-2 text-xs text-muted-foreground">Fields that look like reasoning content were withheld. Aegis shows what an agent did and the context it reported, not what it was thinking.</p>
            )}
            <MetadataView metadata={e.context} />
          </Section>

          <p className="flex flex-wrap gap-4 text-xs">
            <Link href={`/activity/${e.id}`} className="text-foreground hover:underline">
              Open activity event
            </Link>
            <Link href={`/agents/${agentSlug}?tab=graph&trace=${encodeURIComponent(traceId)}#evt-${item.id}`} className="text-muted-foreground hover:underline">
              Link to this action
            </Link>
          </p>
        </div>
      </details>

      {item.children.length > 0 && (
        <div className="mt-1.5">
          <ActionTimeline items={item.children} agentName={agentName} agentSlug={agentSlug} traceId={traceId} runStart={runStart} />
        </div>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
