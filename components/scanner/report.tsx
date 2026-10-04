import { ShieldCheck } from "lucide-react";

import { AGENT_TYPES } from "@/lib/scanner/catalog";
import { LEVEL_LABEL } from "@/lib/scanner/engine";
import type { Evidence, Finding, RiskLevel, ScanResult } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";
import { COVERAGE_LABEL, ControlStatusBadge, LEVEL_TONE, LevelBadge, SeverityBadge } from "@/components/scanner/severity";

const BAR_TONE = { low: "bg-success", moderate: "bg-warning", high: "bg-risk", critical: "bg-danger" } as const satisfies Record<RiskLevel, string>;
const SCORE_TONE = { low: "text-success", moderate: "text-warning", high: "text-risk", critical: "text-danger" } as const satisfies Record<RiskLevel, string>;

const barLevel = (score: number): RiskLevel | null => (score >= 100 ? "critical" : score >= 75 ? "high" : score >= 50 ? "moderate" : score > 0 ? "low" : null);

export function agentTypeLabel(agentType: string, custom: string | null): string {
  const type = AGENT_TYPES.find((t) => t.id === agentType);
  if (type && type.id !== "other") return type.label;
  return custom ?? "AI agent";
}

/** The summary sentence. Worded as indication, never as a verdict. */
export function summaryLine(result: ScanResult): string {
  const { high, medium } = result.counts;
  if (high === 0 && medium === 0 && result.counts.low === 0) return "Based on your answers, this configuration does not indicate elevated risk in the areas the scanner checks.";
  if (result.level === "low") return "Based on your answers, this configuration indicates relatively limited risk. A few areas are still worth a look.";
  if (result.level === "moderate") return "Your configuration indicates some risk that is worth addressing before the agent takes on more.";
  return "Your configuration indicates elevated risk. These areas create potential security risk and deserve attention first.";
}

function EvidenceItem({ e }: { e: Evidence }) {
  return (
    <li className="flex items-start gap-2 text-sm text-foreground">
      <span className={cn("mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium", e.kind === "observed" ? "bg-surface-muted text-foreground" : "bg-info-bg text-info")}>
        {e.kind === "observed" ? "Observed" : "Inferred"}
      </span>
      <span>{e.text}</span>
    </li>
  );
}

function FindingCard({ finding, index, open }: { finding: Finding; index: number; open: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 w-5 shrink-0 text-sm tabular-nums text-muted-foreground">{index + 1}.</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{finding.title}</span>
            <SeverityBadge severity={finding.severity} />
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">{finding.headline}</span>
        </span>
        <span aria-hidden="true" className="mt-1 text-xs text-muted-foreground group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4 text-sm">
        <section>
          <h4 className="section-label">What we observed</h4>
          <ul className="mt-2 space-y-1.5">
            {finding.evidence.map((e, i) => (
              <EvidenceItem key={i} e={e} />
            ))}
          </ul>
          {finding.inherentSeverity !== finding.severity && (
            <p className="mt-2 text-xs text-muted-foreground">Severity reflects the controls you reported: without them this would rate {finding.inherentSeverity}.</p>
          )}
        </section>
        <section>
          <h4 className="section-label">Why it matters</h4>
          <p className="mt-1.5 text-foreground">{finding.whyItMatters}</p>
        </section>
        <section>
          <h4 className="section-label">Potential impact</h4>
          <p className="mt-1.5 text-foreground">{finding.potentialImpact}</p>
        </section>
        <section>
          <h4 className="section-label">Recommended mitigation</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground">
            {finding.mitigations.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-surface-muted p-3.5">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Aegis · {COVERAGE_LABEL[finding.aegis.coverage]}
          </h4>
          <p className="mt-1.5 text-foreground">{finding.aegis.summary}</p>
          <ul className="mt-2.5 space-y-1.5">
            {finding.aegis.controls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <ControlStatusBadge status={c.status} />
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="text-muted-foreground">— {c.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}

/**
 * The assessment itself. Pure presentation of a stored ScanResult: it adds no claims of its own, and
 * every string it renders was produced by the engine from allowlisted ids (React escapes the rest).
 */
export function ScanReport({ result, agentLabel, createdAt }: { result: ScanResult; agentLabel: string; createdAt: Date }) {
  const { counts } = result;
  return (
    <div className="space-y-8">
      <header>
        <p className="section-label">AI agent security report</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Your AI Agent Security Report</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {agentLabel} · scanned {createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · method {result.engineVersion}
        </p>
      </header>

      <section aria-labelledby="overall" className="rounded-xl border border-border bg-surface p-5 sm:p-7">
        <h2 id="overall" className="section-label">
          Overall risk
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
          <p className={cn("text-6xl font-semibold tabular-nums tracking-tight", SCORE_TONE[result.level])} aria-label={`Overall risk ${result.score} out of 100`}>
            {result.score}
            <span className="text-2xl font-normal text-muted-foreground"> / 100</span>
          </p>
          <div className="pb-1.5">
            <LevelBadge level={result.level} />
            <p className="mt-1 text-xs text-muted-foreground">Risk level: {LEVEL_LABEL[result.level].toUpperCase()}</p>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-sm text-foreground">{summaryLine(result)}</p>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="High-risk behaviors" value={counts.high} tone="risk" />
          <Stat label="Medium-risk behaviors" value={counts.medium} tone="warning" />
          <Stat label="Lower-risk notes" value={counts.low} tone="info" />
          <Stat label="Protected areas" value={counts.protectedAreas} tone="success" />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">{result.disclaimer}</p>
        {result.controlsConfirmed < result.controlsTotal && (
          <p className="mt-2 text-xs text-muted-foreground">
            You confirmed {result.controlsConfirmed} of {result.controlsTotal} controls. Controls marked “Not sure” earn little credit, so confirming them can change this result.
          </p>
        )}
      </section>

      {result.findings.length > 0 && (
        <section aria-labelledby="top-risks">
          <h2 id="top-risks" className="text-lg font-semibold text-foreground">
            Top risks
          </h2>
          <ol className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {result.findings.slice(0, 4).map((f, i) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="text-foreground">
                  <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                  {f.title}
                </span>
                <SeverityBadge severity={f.severity} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="breakdown">
        <h2 id="breakdown" className="text-lg font-semibold text-foreground">
          Security breakdown
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Remaining risk by area, after the controls you reported.</p>
        <ul className="mt-3 space-y-3 rounded-lg border border-border bg-surface p-4">
          {result.breakdown.map((b) => {
            const level = barLevel(b.score);
            return (
              <li key={b.dimension}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{b.label}</span>
                  <span className="text-xs text-muted-foreground">{level ? LEVEL_LABEL[level] : "No elevated risk indicated"}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${b.label}: ${level ? LEVEL_LABEL[level] : "no elevated risk indicated"}`}>
                  <div className={cn("h-full rounded-full", level ? BAR_TONE[level] : "")} style={{ width: `${b.score}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {result.findings.length > 0 ? (
        <section aria-labelledby="findings">
          <h2 id="findings" className="text-lg font-semibold text-foreground">
            Findings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Each finding separates what you told us (observed), what we infer from it, and what we recommend.</p>
          <div className="mt-3 space-y-3">
            {result.findings.map((f, i) => (
              <FindingCard key={f.id} finding={f} index={i} open={i < 2} />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-surface p-5 text-sm text-foreground">
          No elevated-risk behaviors were indicated by the answers you gave. That describes the configuration you entered, not a guarantee about the agent itself.
        </section>
      )}

      {result.findings.length > 1 && (
        <section aria-labelledby="fix-first">
          <h2 id="fix-first" className="text-lg font-semibold text-foreground">
            What to fix first
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Ordered by potential impact, highest first.</p>
          <ol className="mt-3 space-y-2">
            {result.findings.slice(0, 5).map((f, i) => (
              <li key={f.id} className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <span className="tabular-nums text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="font-medium text-foreground">{f.title}</span>
                  <span className="block text-muted-foreground">{f.mitigations[0]}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(result.protectedAreas.length > 0 || result.notIndicated.length > 0) && (
        <section aria-labelledby="protected">
          <h2 id="protected" className="text-lg font-semibold text-foreground">
            Protected areas
          </h2>
          {result.protectedAreas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {result.protectedAreas.map((p) => (
                <li key={p.id} className="rounded-lg border border-success-border bg-success-bg px-4 py-3 text-sm">
                  <span className="font-medium text-foreground">{p.title}</span>
                  <span className="block text-muted-foreground">{p.because}</span>
                </li>
              ))}
            </ul>
          )}
          {result.notIndicated.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No exposure indicated by your answers: {result.notIndicated.map((n) => n.title.toLowerCase()).join(", ")}.
            </p>
          )}
        </section>
      )}

      {result.pasted && result.pasted.signals.length > 0 && (
        <section aria-labelledby="pasted">
          <h2 id="pasted" className="text-lg font-semibold text-foreground">
            Signals from your pasted content
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyzed in memory and discarded. Statements in pasted text are never credited as controls, and instruction-like text has no effect on the score.
          </p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {result.pasted.signals.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-foreground">{s.label}</span>
                <span className="tabular-nums text-muted-foreground">×{s.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "risk" | "warning" | "info" | "success" }) {
  const color = { risk: "text-risk", warning: "text-warning", info: "text-info", success: "text-success" }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3.5 py-3">
      <dd className={cn("text-2xl font-semibold tabular-nums", color)}>{value}</dd>
      <dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

export { LEVEL_TONE };
