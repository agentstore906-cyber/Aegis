import { Eye, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";

const PILLARS = [
  {
    icon: Eye,
    title: "Observe",
    description: "See every agent action, tool call, failure, and decision as it happens.",
  },
  {
    icon: SlidersHorizontal,
    title: "Control",
    description: "Define what agents can and cannot do, and enforce it before actions run.",
  },
  {
    icon: ShieldCheck,
    title: "Secure",
    description: "Identify dangerous or unusual behavior before it becomes an incident.",
  },
  {
    icon: Wallet,
    title: "Optimize",
    description: "Track spend per agent, per model, and per task — and catch cost spikes early.",
  },
];

export function ControlPlaneSection() {
  return (
    <section id="solution" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            One control plane for every agent.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Aegis sits between your agents and the systems they touch — giving every
            team a single, consistent view of AI activity across the company.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-4xl">
          <div className="flex flex-col items-center gap-3">
            <FlowRow labels={["AI Agents"]} />
            <Connector />
            <div className="flex items-center gap-2 rounded-lg border border-border bg-foreground px-5 py-2.5 text-background">
              <LogoMark className="size-4" inverted />
              <span className="text-sm font-medium">Aegis</span>
            </div>
            <Connector />
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PILLARS.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-surface p-4 text-left"
                >
                  <Icon className="size-4 text-brand" aria-hidden="true" />
                  <p className="mt-2.5 text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
            <Connector />
            <FlowRow labels={["Models", "Tools", "Company systems"]} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Connector() {
  return <div className="h-6 w-px bg-border" aria-hidden="true" />;
}

function FlowRow({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-md border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
