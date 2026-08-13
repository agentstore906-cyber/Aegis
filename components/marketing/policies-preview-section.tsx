import { ArrowRight } from "lucide-react";
import { PreviewLabel } from "@/components/marketing/preview-label";
import { Badge } from "@/components/ui/badge";

const RULES = [
  { condition: "Refund > $500", decision: "REQUIRE APPROVAL", tone: "warning" as const },
  { condition: "Delete customer data", decision: "BLOCK", tone: "danger" as const },
  { condition: "Production deployment", decision: "REQUIRE APPROVAL", tone: "warning" as const },
  { condition: "Export customer database", decision: "BLOCK", tone: "danger" as const },
];

export function PoliciesPreviewSection() {
  return (
    <section id="policies" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <PreviewLabel>Live — Policy Engine</PreviewLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
              Turn company rules into agent guardrails.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Define what your agents are allowed to do — and let Aegis enforce it
              automatically, before an action executes.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-md border border-border px-2.5 py-1">Agent action</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
              <span className="rounded-md border border-border px-2.5 py-1">Policy engine</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
              <span className="rounded-md border border-border px-2.5 py-1">
                Allow · Approval · Block
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-2">
            <ul className="divide-y divide-border">
              {RULES.map((rule) => (
                <li
                  key={rule.condition}
                  className="flex items-center justify-between gap-4 px-4 py-3.5"
                >
                  <span className="font-mono text-sm text-foreground">{rule.condition}</span>
                  <Badge tone={rule.tone}>{rule.decision}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
