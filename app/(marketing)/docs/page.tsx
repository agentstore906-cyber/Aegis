import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How Aegis's policy engine, approvals, security, billing, and API actually work.",
};

const SECTIONS = [
  {
    href: "/docs/policies",
    title: "Policies & permissions",
    description: "The two-layer decision model: baseline permissions and conditional policies.",
  },
  {
    href: "/docs/approvals",
    title: "Approvals & audit",
    description: "How REQUIRE_APPROVAL decisions become real, resolvable requests — and the audit trail behind them.",
  },
  {
    href: "/docs/security",
    title: "Security intelligence",
    description: "The deterministic detectors that turn activity into security alerts.",
  },
  {
    href: "/docs/billing",
    title: "Billing & plans",
    description: "How plan limits are defined once and enforced server-side, not just displayed.",
  },
  {
    href: "/docs/deployment",
    title: "Deployment",
    description: "Environment variables, migrations, health checks, and what's deployment-dependent.",
  },
  {
    href: "/docs/api",
    title: "API reference",
    description: "Every public endpoint: authentication, requests, responses, and error codes.",
  },
  {
    href: "/docs/sdk",
    title: "SDK reference",
    description: "@aegis/agent-sdk — install, initialize, track, and authorize.",
  },
];

export default function DocsIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-sm font-medium text-muted-foreground">Documentation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Documentation
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        How Aegis actually works, written against the real implementation — not aspirational feature copy.
      </p>

      <div className="mt-10 divide-y divide-border rounded-xl border border-border">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="focus-ring group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-muted"
          >
            <div>
              <p className="text-sm font-semibold text-foreground">{section.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
            </div>
            <ArrowRight
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Building an integration? Start with the{" "}
        <Link href="/docs/sdk" className="text-brand underline underline-offset-2">
          SDK reference
        </Link>{" "}
        or sign up and follow the in-app quickstart at Developers → Quickstart.
      </p>
    </div>
  );
}
