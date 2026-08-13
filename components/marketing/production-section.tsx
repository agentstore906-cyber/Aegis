import { Building2, ShieldCheck, Gauge, ScrollText } from "lucide-react";

const FACTS = [
  {
    icon: Building2,
    title: "Multi-tenant from day one",
    description: "Every organization, agent, and event is isolated at the data layer — not bolted on later.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based access control",
    description: "Six built-in roles, from Owner to Finance, backed by one central capability map.",
  },
  {
    icon: Gauge,
    title: "Rate-limited, idempotent API",
    description: "The public API is rate-limited per key and safe to retry with an Idempotency-Key.",
  },
  {
    icon: ScrollText,
    title: "Append-only audit trail",
    description: "Every policy, permission, and approval change is recorded — nothing is edited in place.",
  },
];

export function ProductionSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            From your first agent to thousands.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Aegis is built on the same foundations whether you&apos;re running one agent
            or coordinating an entire AI workforce.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2">
          {FACTS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-border bg-surface p-5">
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
