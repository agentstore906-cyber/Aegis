import { Database, Mail, Code2, Rocket, Banknote, Server } from "lucide-react";

const CAPABILITIES = [
  { icon: Database, label: "Read customer data" },
  { icon: Server, label: "Modify CRM records" },
  { icon: Mail, label: "Send emails" },
  { icon: Code2, label: "Execute code" },
  { icon: Rocket, label: "Deploy software" },
  { icon: Banknote, label: "Issue refunds" },
];

export function ProblemSection() {
  return (
    <section className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground">
            Your agents are getting more powerful. Your control systems aren&apos;t.
          </h2>
          <p className="mt-4 text-muted-foreground">
            AI agents increasingly act on their own — reading data, calling APIs, and
            taking real actions in production systems. Every new capability adds
            operational, financial, and security risk.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
