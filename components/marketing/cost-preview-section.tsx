import { PreviewLabel } from "@/components/marketing/preview-label";

const BY_TEAM = [
  { label: "Engineering", value: "$5,420" },
  { label: "Sales", value: "$3,180" },
  { label: "Support", value: "$2,110" },
  { label: "Operations", value: "$2,130" },
];

const BY_AGENT = [
  { label: "Coding Agent", value: "$3,820", pct: 100 },
  { label: "Research Agent", value: "$2,140", pct: 56 },
  { label: "Support Agent", value: "$1,830", pct: 48 },
  { label: "Sales Agent", value: "$1,420", pct: 37 },
];

export function CostPreviewSection() {
  return (
    <section id="developers" className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <PreviewLabel>Coming next — Cost Intelligence</PreviewLabel>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
            Know where every AI dollar goes.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Aegis attributes spend to every agent, team, and model automatically.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              AI spend · this month
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">$12,840</p>
            <ul className="mt-4 space-y-2.5">
              {BY_TEAM.map((row) => (
                <li key={row.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums text-foreground">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cost by agent
            </p>
            <ul className="mt-4 space-y-3.5">
              {BY_AGENT.map((row) => (
                <li key={row.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{row.label}</span>
                    <span className="font-medium tabular-nums text-foreground">{row.value}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted">
                    <div
                      className="h-1.5 rounded-full bg-brand"
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
