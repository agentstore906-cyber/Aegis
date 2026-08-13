import { Webhook, Code2, MessageSquare, Bell, BarChart3 } from "lucide-react";

const LIVE = [
  {
    icon: Webhook,
    title: "Webhooks",
    description: "HMAC-signed, SSRF-protected outbound events for alerts, approvals, and cost anomalies.",
  },
  {
    icon: Code2,
    title: "REST API & SDK",
    description: "A versioned public API and a typed TypeScript SDK for real agent processes.",
  },
];

const COMING_SOON = [
  { icon: MessageSquare, title: "Slack" },
  { icon: Bell, title: "PagerDuty" },
  { icon: BarChart3, title: "Datadog" },
];

export function IntegrationsSection() {
  return (
    <section id="integrations" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            Fits into how you already work.
          </h2>
          <p className="mt-4 text-muted-foreground">
            One generic, secure integration point today — built so any downstream tool
            can plug in.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {LIVE.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <Icon className="size-5 text-foreground" aria-hidden="true" />
                <span className="rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-xs font-medium text-success">
                  Live
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-3 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
          {COMING_SOON.map(({ icon: Icon, title }) => (
            <div
              key={title}
              className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface-muted p-5 opacity-60"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
              </div>
              <span className="text-xs text-muted-foreground">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
