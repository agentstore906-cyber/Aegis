import { LogoMark } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";

const ACTIVITY = [
  {
    time: "10:42:31",
    agent: "Sales Agent",
    action: "Read CRM contact",
    status: "ALLOWED" as const,
  },
  {
    time: "10:43:04",
    agent: "Research Agent",
    action: "External search",
    status: "ALLOWED" as const,
  },
  {
    time: "10:44:12",
    agent: "Finance Agent",
    action: "Issue refund · $1,250",
    status: "APPROVAL" as const,
  },
  {
    time: "10:45:03",
    agent: "Deployment Agent",
    action: "Production deployment",
    status: "BLOCKED" as const,
  },
];

const STATUS_STYLE = {
  ALLOWED: "success",
  APPROVAL: "warning",
  BLOCKED: "danger",
} as const;

const STATUS_LABEL = {
  ALLOWED: "Allowed",
  APPROVAL: "Approval required",
  BLOCKED: "Blocked",
} as const;

export function ProductVisual() {
  return (
    <div className="w-full rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-16px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <LogoMark className="size-5 text-foreground" />
          <span className="text-sm font-medium text-foreground">AI Control Center</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          Live
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[
          { label: "Agents", value: "42" },
          { label: "Active", value: "38", tone: "text-success" },
          { label: "Paused", value: "3" },
          { label: "Needs attention", value: "1", tone: "text-warning" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-3.5">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${stat.tone ?? "text-foreground"}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-[1.3fr_1fr]">
        <div className="bg-surface p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Activity
          </p>
          <ul className="space-y-3">
            {ACTIVITY.map((item) => (
              <li key={item.time} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {item.time}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{item.agent}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.action}</p>
                  </div>
                </div>
                <Badge tone={STATUS_STYLE[item.status]} dot className="shrink-0">
                  {STATUS_LABEL[item.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approval required
          </p>
          <div className="rounded-lg border border-warning-border bg-warning-bg p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Finance Agent</p>
              <Badge tone="warning">Risk: High</Badge>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Action</dt>
                <dd className="text-foreground">Issue refund</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">$1,250</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-foreground">Acme Inc.</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <div className="flex-1 rounded-md border border-border bg-surface py-1.5 text-center text-xs font-medium text-foreground">
                Reject
              </div>
              <div className="flex-1 rounded-md bg-foreground py-1.5 text-center text-xs font-medium text-background">
                Approve
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
