import Link from "next/link";

import { controlsForCategories } from "@/lib/scanner/aegis-controls";
import type { ScanResult } from "@/lib/scanner/types";
import { ControlStatusBadge, SeverityBadge } from "@/components/scanner/severity";

/**
 * "Your Aegis Security Setup": the detected risks, and the Aegis controls that answer them. Only
 * controls that exist are linked; anything not built is labelled "Coming soon" or "Outside Aegis".
 */
export function AegisSetup({ result }: { result: ScanResult }) {
  const controls = controlsForCategories(result.findings.map((f) => f.id));
  return (
    <section aria-labelledby="setup" className="rounded-lg border border-border bg-surface">
      <header className="border-b border-border px-4 py-3">
        <h2 id="setup" className="section-label">
          Your Aegis security setup
        </h2>
      </header>
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Detected risks</h3>
          {result.findings.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No elevated-risk behaviors were indicated by this scan.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {result.findings.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground">{f.title}</span>
                  <SeverityBadge severity={f.severity} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Recommended Aegis controls</h3>
          {controls.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing to set up from this scan.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {controls.map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.href && (c.status === "available" || c.status === "partial") ? (
                      <Link href={c.href} className="focus-ring rounded-sm font-medium text-foreground underline underline-offset-2">
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{c.name}</span>
                    )}
                    <ControlStatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Aegis returns decisions to agents that ask it (SDK <code>guard()</code> or the evaluate API) and records what happened. A control only applies to actions your agent routes through Aegis.
      </p>
    </section>
  );
}
