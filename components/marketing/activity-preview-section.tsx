import { Badge } from "@/components/ui/badge";

const FILTERS = ["Agent", "Action", "Status", "Risk", "Time"];

const ROWS = [
  { time: "10:42:31", agent: "Sales Agent", action: "Read CRM contact", status: "success" as const, label: "Allowed" },
  { time: "10:43:04", agent: "Sales Agent", action: "Search company", status: "success" as const, label: "Allowed" },
  { time: "10:44:12", agent: "Sales Agent", action: "Generate outbound email", status: "success" as const, label: "Allowed" },
  { time: "10:44:18", agent: "Sales Agent", action: "SEND_EMAIL", status: "warning" as const, label: "Approval required" },
];

export function ActivityPreviewSection() {
  return (
    <section id="activity" className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            Every agent action. One timeline.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Structured, searchable activity for every agent — down to the individual
            tool call.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3.5">
            {FILTERS.map((filter) => (
              <span
                key={filter}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                {filter}
              </span>
            ))}
          </div>
          <ul className="divide-y divide-border">
            {ROWS.map((row) => (
              <li
                key={row.time}
                className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-4">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                    {row.time}
                  </span>
                  <span className="w-28 shrink-0 text-sm font-medium text-foreground">
                    {row.agent}
                  </span>
                  <span className="text-sm text-muted-foreground">{row.action}</span>
                </div>
                <Badge tone={row.status} dot>
                  {row.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
