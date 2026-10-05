import type { Metadata } from "next";
import { Eye, FileText, ShieldCheck, Timer } from "lucide-react";

import { ScannerWizard } from "@/components/scanner/scanner-wizard";
import { getSiteUrl } from "@/lib/seo";

const TITLE = "Free AI Agent Security Scanner";
const DESCRIPTION = "Scan your AI agent for risky permissions, autonomous actions, sensitive-data exposure, tool risks, and missing security controls.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${getSiteUrl()}/scan` },
  openGraph: { type: "website", url: `${getSiteUrl()}/scan`, title: `${TITLE} | Aegis`, description: DESCRIPTION, siteName: "Aegis" },
  twitter: { card: "summary_large_image", title: `${TITLE} | Aegis`, description: DESCRIPTION },
};

const POINTS = [
  { icon: Timer, title: "About a minute", text: "Five short steps. No account, no install, no agent access." },
  { icon: Eye, title: "Explainable", text: "Every finding shows what you told us, what we infer, and why it matters." },
  { icon: FileText, title: "A real report", text: "Prioritized risks and concrete mitigations you can act on today." },
  { icon: ShieldCheck, title: "Private by design", text: "Pasted text is analyzed in memory and never stored or executed." },
];

export default function ScanPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pt-14 pb-8 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium text-muted-foreground">Free AI Agent Risk Scanner</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">Scan your AI agent in 60 seconds.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-pretty text-muted-foreground">Discover dangerous agent behaviors before they become incidents.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <ScannerWizard />
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-center text-xl font-semibold tracking-tight text-foreground">What the scanner does — and doesn’t</h2>
          <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon className="size-5 text-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground">
            The scanner is a self-assessment: it analyzes the configuration you describe with a transparent, rule-based method and gives an indication of risk. It doesn’t connect to, test, or execute your agent, and it isn’t a penetration test.
          </p>
        </div>
      </section>
    </>
  );
}
