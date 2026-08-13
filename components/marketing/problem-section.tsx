import { EyeOff, TrendingUp, OctagonAlert, Ungroup } from "lucide-react";

const PROBLEMS = [
  {
    icon: EyeOff,
    title: "No visibility",
    description: "Agents call tools, read data, and take actions with no shared record of what happened.",
  },
  {
    icon: TrendingUp,
    title: "Unpredictable costs",
    description: "A single runaway agent can quietly turn a $12/day workload into a $900 bill.",
  },
  {
    icon: OctagonAlert,
    title: "Silent failures",
    description: "Loops, retries, and bad decisions go unnoticed until a customer or a bill surfaces them.",
  },
  {
    icon: Ungroup,
    title: "No central control",
    description: "Permissions live in a dozen scripts and API keys, not one place anyone can audit.",
  },
];

export function ProblemSection() {
  return (
    <section className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground">
            AI agents are easy to deploy. Hard to control.
          </h2>
          <p className="mt-4 text-muted-foreground">
            AI agents increasingly act on their own — reading data, calling APIs, and
            taking real actions in production systems. Every new capability adds
            operational, financial, and security risk.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
