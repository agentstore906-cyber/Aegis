import { LogoMark } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

const AGENTS = [
  { name: "Sales Agent", status: "success" as const, label: "Active", runsToday: 128 },
  { name: "Research Agent", status: "warning" as const, label: "Cost anomaly", runsToday: 341 },
  { name: "Finance Agent", status: "success" as const, label: "Active", runsToday: 42 },
  { name: "Deployment Agent", status: "neutral" as const, label: "Paused", runsToday: 0 },
];

const ALERTS = [
  { title: "Research Agent — spend 8x above daily average", tone: "danger" as const, severity: "Critical" },
  { title: "Sales Agent — first-ever crm.export attempt", tone: "warning" as const, severity: "High" },
];

const ACTIVITY = [
  { time: "09:14:02", agent: "Sales Agent", action: "Read CRM contact", status: "success" as const, label: "Allowed" },
  { time: "09:15:41", agent: "Finance Agent", action: "Issue refund · $1,250", status: "warning" as const, label: "Approval required" },
  { time: "09:16:09", agent: "Research Agent", action: "External search", status: "success" as const, label: "Allowed" },
  { time: "09:17:22", agent: "Deployment Agent", action: "Production deployment", status: "danger" as const, label: "Blocked" },
];

export function ProductPreviewSection() {
  return (
    <section id="preview" className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            Everything about your agents, in one screen.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Agents, runs, cost, and alerts — the same control room every teammate looks at.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-16px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <LogoMark className="size-5 text-foreground" />
              <span className="text-sm font-medium text-foreground">Aegis Overview</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Live
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {[
              { label: "Agents", value: "12" },
              { label: "Runs", value: "8,421" },
              { label: "Cost", value: "$127.40" },
              { label: "Alerts", value: "3", tone: "text-danger" },
            ].map((stat) => (
              <div key={stat.label} className="bg-surface px-4 py-3.5">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${stat.tone ?? "text-foreground"}`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-px bg-border lg:grid-cols-[1.1fr_1fr]">
            <div className="bg-surface p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Agents
              </p>
              <ul className="space-y-2.5">
                {AGENTS.map((agent) => (
                  <li key={agent.name} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.runsToday} runs today</p>
                    </div>
                    <Badge tone={agent.status} dot className="shrink-0">
                      {agent.label}
                    </Badge>
                  </li>
                ))}
              </ul>

              <p className="mt-5 mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent activity
              </p>
              <ul className="space-y-2.5">
                {ACTIVITY.map((item) => (
                  <li key={item.time} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.time}</span>
                      <span className="truncate text-muted-foreground">
                        <span className="font-medium text-foreground">{item.agent}</span> · {item.action}
                      </span>
                    </div>
                    <Badge tone={item.status} dot className="shrink-0">
                      {item.label}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-surface p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Alerts needing attention
              </p>
              <ul className="space-y-2.5">
                {ALERTS.map((alert) => (
                  <li
                    key={alert.title}
                    className="rounded-lg border border-border p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-foreground">{alert.title}</p>
                      <Badge tone={alert.tone} className="shrink-0">
                        {alert.severity}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-5 mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Spend this month
              </p>
              <div className="rounded-lg border border-border p-3.5">
                <p className="text-2xl font-semibold tabular-nums text-foreground">$3,214</p>
                <p className="mt-1 text-xs text-muted-foreground">+18% vs. last month</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <ButtonLink href="/demo" variant="secondary" size="lg">
            Open live demo
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
