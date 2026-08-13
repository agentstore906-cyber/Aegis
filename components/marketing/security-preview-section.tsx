import { PreviewLabel } from "@/components/marketing/preview-label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp } from "lucide-react";

export function SecurityPreviewSection() {
  return (
    <section id="security" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <PreviewLabel>Live — Security</PreviewLabel>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
            Know when an agent behaves differently.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Deterministic, explainable detectors compare each agent&apos;s activity
            against its own history and flag the moment something changes.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-danger-border bg-danger-bg p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
              <p className="text-xs font-medium uppercase tracking-wide text-danger">
                Security alert
              </p>
            </div>
            <p className="mt-3 text-sm text-foreground">
              <span className="font-medium">Sales Agent</span> requested a permission
              it has never used before.
            </p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Action</dt>
                <dd className="font-mono text-foreground">EXPORT_CUSTOMERS</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Normal behavior</dt>
                <dd className="font-mono text-foreground">READ_CUSTOMERS</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Risk</dt>
                <dd>
                  <Badge tone="danger">High</Badge>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-warning-border bg-warning-bg p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-warning" aria-hidden="true" />
              <p className="text-xs font-medium uppercase tracking-wide text-warning">
                Cost anomaly
              </p>
            </div>
            <p className="mt-3 text-sm text-foreground">
              <span className="font-medium">Research Agent</span> spend is
              significantly above its normal range.
            </p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Normal</dt>
                <dd className="text-foreground">$12/day</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Today</dt>
                <dd className="font-medium text-foreground">$94/day</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Likely contributor</dt>
                <dd className="text-foreground">Repeated execution loop</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
