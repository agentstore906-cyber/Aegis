import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetadataView } from "@/components/activity/metadata-view";
import { label as statusLabel } from "@/lib/incidents/status";
import type { Claim, EvidenceRecord, EvidenceRef, EvidenceType, Reconstruction, TimelineItem, TimelineKind, Tone } from "@/lib/incidents/types";
import { formatDateTime } from "@/lib/utils";

const TYPE_LABEL: Record<EvidenceType, string> = {
  security_alert: "alert",
  alert_occurrence: "alert occurrence",
  activity_event: "event",
  policy_evaluation: "decision",
  approval_request: "approval",
  approval_decision: "approval decision",
  behavioral_deviation: "deviation",
  trust_transition: "trust change",
  audit_event: "audit",
};

const KIND_LABEL: Record<TimelineKind, string> = {
  ALERT: "Alert",
  ACTION: "Action",
  DECISION: "Decision",
  POLICY: "Policy",
  RISK: "Risk",
  DEVIATION: "Unusual",
  TRUST: "Trust",
  APPROVAL: "Approval",
  ENFORCEMENT: "Aegis",
  CONTROL: "Operator",
  OUTCOME: "Outcome",
};

const toneBadge: Record<Tone, "neutral" | "info" | "warning" | "danger" | "success"> = { neutral: "neutral", info: "info", warning: "warning", danger: "danger", success: "success" };

export const evidenceAnchor = (ref: EvidenceRef) => `ev-${ref.type}-${ref.id}`;

function Chips({ refs, total }: { refs: EvidenceRef[]; total: number }) {
  if (refs.length === 0) return null;
  const shown = refs.slice(0, 6);
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
      {shown.map((ref) => (
        <a
          key={`${ref.type}:${ref.id}`}
          href={`#${evidenceAnchor(ref)}`}
          className="rounded border border-border bg-surface-muted px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          title={`Jump to this ${TYPE_LABEL[ref.type]} in the evidence list`}
        >
          {TYPE_LABEL[ref.type]}
        </a>
      ))}
      {total > shown.length && <span className="text-[10px] text-muted-foreground">+{total - shown.length} more</span>}
    </span>
  );
}

function ClaimList({ claims, empty }: { claims: Claim[]; empty: string }) {
  if (claims.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2 text-sm text-foreground">
      {claims.map((c, i) => (
        <li key={i}>
          {c.text}
          <Chips refs={c.evidence} total={c.evidenceTotal} />
        </li>
      ))}
    </ul>
  );
}

/** The first screen: what happened, why, what Aegis did, and what supports it. */
export function IncidentSummaryPanels({ reconstruction, evidenceSince }: { reconstruction: Reconstruction; evidenceSince: { added: number } | null }) {
  const { summary } = reconstruction;
  const byType = new Map<EvidenceType, number>();
  for (const e of reconstruction.evidence) byType.set(e.ref.type, (byType.get(e.ref.type) ?? 0) + 1);

  return (
    <div>
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">{summary.paragraph}</p>
      {evidenceSince && (
        <p className="mt-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
          {evidenceSince.added} new piece{evidenceSince.added === 1 ? "" : "s"} of evidence {evidenceSince.added === 1 ? "has" : "have"} been recorded since this incident&rsquo;s status was last changed.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What happened?</CardTitle>
          </CardHeader>
          <CardContent>
            <ClaimList claims={summary.what} empty="No stored evidence describes what the agent did." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Why?</CardTitle>
          </CardHeader>
          <CardContent>
            <ClaimList claims={summary.why} empty="Nothing stored explains why beyond the triggering record itself." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What did Aegis do?</CardTitle>
          </CardHeader>
          <CardContent>
            <ClaimList claims={summary.aegis} empty="No Aegis decision, approval or enforcement is recorded for this incident." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What evidence supports it?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">
              {reconstruction.evidenceCount} stored record{reconstruction.evidenceCount === 1 ? "" : "s"}:{" "}
              {[...byType.entries()].map(([t, n]) => `${n} ${TYPE_LABEL[t]}${n === 1 ? "" : "s"}`).join(", ") || "none"}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every statement on this page links to the records it rests on. <a href="#evidence" className="underline">Inspect the evidence</a>.
            </p>
            {summary.gaps.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not recorded / not shown</h4>
                <ClaimList claims={summary.gaps} empty="" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function IncidentTimeline({ items, truncated }: { items: TimelineItem[]; truncated: boolean }) {
  return (
    <div>
      <ol className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} id={`item-${item.id}`} className="scroll-mt-24">
            <details className={`rounded-md border bg-surface ${item.trigger ? "border-brand" : "border-border"}`}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                <time className="w-28 shrink-0 font-mono text-xs tabular-nums text-muted-foreground" dateTime={item.at.toISOString()}>
                  {item.at.toISOString().slice(11, 23)}
                </time>
                <Badge tone={toneBadge[item.tone]}>{KIND_LABEL[item.kind]}</Badge>
                {item.trigger && <Badge tone="brand">Trigger</Badge>}
                <span className="text-foreground">{item.title}</span>
              </summary>
              <div className="space-y-3 border-t border-border px-4 py-3 text-xs">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Time (UTC)</dt>
                    <dd className="text-foreground">{item.at.toISOString()}</dd>
                  </div>
                  {Object.entries(item.detail).flatMap(([k, v]) =>
                    v === null || v === "" ? [] : [
                      <div key={k}>
                        <dt className="text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
                        <dd className="break-words text-foreground">{String(v)}</dd>
                      </div>,
                    ]
                  )}
                </dl>
                <p className="text-muted-foreground">
                  Evidence:
                  <Chips refs={item.evidence} total={item.evidence.length} />
                </p>
              </div>
            </details>
          </li>
        ))}
      </ol>
      {truncated && (
        <p className="mt-2 text-xs text-muted-foreground">
          The timeline is capped; the earliest items and the trigger are shown. Every stored record is still listed under Evidence.
        </p>
      )}
    </div>
  );
}

export function EvidenceList({ evidence }: { evidence: EvidenceRecord[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {evidence.map((rec) => (
        <li key={`${rec.ref.type}:${rec.ref.id}`} id={evidenceAnchor(rec.ref)} className="scroll-mt-24">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
              <Badge tone="neutral">{TYPE_LABEL[rec.ref.type]}</Badge>
              <span className="text-foreground">{rec.label}</span>
              <time className="text-xs text-muted-foreground" dateTime={rec.at.toISOString()}>
                {formatDateTime(rec.at)}
              </time>
            </summary>
            <div className="space-y-2 border-t border-border px-4 py-3">
              <p className="font-mono text-[11px] text-muted-foreground">
                {rec.ref.type} · {rec.ref.id}
              </p>
              <MetadataView metadata={rec.data} />
              {rec.href && (
                <Link href={rec.href} className="text-xs text-foreground hover:underline">
                  Open the original record →
                </Link>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function StatusBadge({ status }: { status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "FALSE_POSITIVE" }) {
  const tone = status === "OPEN" ? "danger" : status === "INVESTIGATING" ? "warning" : status === "RESOLVED" ? "success" : "neutral";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}
