"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runAgentScanAction } from "@/lib/scanner/agent-scan-actions";
import type { AgentScanResult } from "@/lib/scanner/agent-scan-model";

const SEVERITY_TONE = { high: "danger", medium: "warning", low: "neutral", info: "info" } as const;

/**
 * Security scan of a real, connected agent. It can only be started while the backend reports the agent connected;
 * otherwise it says what is missing. Findings are what Aegis observed or tested, each labelled as such — no score.
 */
export function AgentScanPanel({
  slug,
  agentName,
  connectionLabel,
  alertsHref,
  canScan,
  blockedReason,
  scan,
}: {
  slug: string;
  /** Shown in the header when the panel is used outside the agent's own page. */
  agentName?: string;
  connectionLabel?: string;
  alertsHref?: string;
  canScan: boolean;
  /** Why a scan cannot start right now (from the backend's connection state), or null. */
  blockedReason: string | null;
  scan: { createdAtIso: string; result: AgentScanResult } | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await runAgentScanAction(slug);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <section id="scan" className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{agentName ? `Scan Agent — ${agentName}` : "Scan Agent"}</h3>
          {connectionLabel && <p className="mt-0.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">{connectionLabel}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {blockedReason ?? "Aegis verifies your agent live, sends read-only checks to its endpoint, and reads what it has recorded about it. No tool is executed and the agent is sent no content."}
          </p>
        </div>
        {canScan && (
          <Button type="button" variant="secondary" size="sm" disabled={pending || blockedReason !== null} onClick={run}>
            {pending ? "Scanning…" : scan ? "Scan Agent again" : "Scan Agent"}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {scan && (
        <div className="mt-5 space-y-5">
          <p className="text-xs text-muted-foreground">
            Scanned {new Date(scan.createdAtIso).toLocaleString()}
            {alertsHref && (
              <>
                {" · "}
                <a href={alertsHref} className="underline">
                  Security alerts and evidence
                </a>
              </>
            )}
          </p>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Security findings</h4>
            {scan.result.findings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing was found in what Aegis could observe and test. This does not describe the parts of the agent Aegis cannot see.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {scan.result.findings.map((f) => (
                  <li key={f.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                      <span className="text-sm font-medium text-foreground">{f.title}</span>
                      <span className="text-xs text-muted-foreground">{f.basis === "tested" ? "tested" : "observed"}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">What Aegis&rsquo;s policies would return</h4>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {scan.result.tests.map((t) => (
                <li key={t.action}>
                  <span className="text-foreground">{t.label}</span> ({t.action}): {t.decision ?? "could not be answered"}
                </li>
              ))}
            </ul>
          </div>
          {scan.result.endpointTests.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground">Tested against the agent</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {scan.result.endpointTests.map((t) => (
                  <li key={t.id}>
                    <span className="text-foreground">{t.label}</span>: {t.outcome === "passed" ? "passed" : t.outcome === "failed" ? "failed" : "not tested"} — {t.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div role="note" className="rounded-md border border-border bg-surface-muted px-4 py-3">
            <h4 className="text-sm font-semibold text-foreground">Not tested</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              This scan does not test the agent&rsquo;s prompts, source code or model behavior. It is read-only: no tool was executed and the agent was sent no content.
            </p>
            {scan.result.notTested.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {scan.result.notTested.map((n) => (
                  <li key={n.id}>
                    <span className="text-foreground">{n.label}</span> — {n.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">What Aegis observed</h4>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {scan.result.observations.map((o) => (
                <div key={o.id} className={o.kind === "limitation" ? "sm:col-span-2" : undefined}>
                  <dt className="inline text-muted-foreground">{o.label}: </dt>
                  <dd className="inline text-foreground">{o.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}
