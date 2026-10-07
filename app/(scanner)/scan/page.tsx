import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye, FileSearch, PlugZap, ShieldQuestion } from "lucide-react";

import { auth } from "@/lib/auth";
import { getActiveMembership } from "@/lib/organizations/queries";
import { ScannerOrb } from "@/components/scanner/scanner-orb";
import { ButtonLink } from "@/components/ui/button";
import { getSiteUrl } from "@/lib/seo";

const TITLE = "Free Risk Scanner";
const DESCRIPTION = "Aegis connects to your real AI agent, verifies it, and scans it. Findings are what Aegis observed and tested — not a self-assessment and not a score.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${getSiteUrl()}/scan` },
  openGraph: { type: "website", url: `${getSiteUrl()}/scan`, title: `${TITLE} | Aegis`, description: DESCRIPTION, siteName: "Aegis" },
  twitter: { card: "summary_large_image", title: `${TITLE} | Aegis`, description: DESCRIPTION },
};

const STEPS = [
  { icon: PlugZap, title: "Connect Agent", text: "Give Aegis your agent's endpoint and the shared secret it uses. Aegis connects to the agent." },
  { icon: Eye, title: "Aegis verifies it", text: "The agent has to prove it is the agent you configured. If Aegis can't reach it, or it can't prove that, nothing is added and it can't be scanned." },
  { icon: FileSearch, title: "Scan Agent", text: "Aegis verifies the agent again, sends read-only checks to its endpoint, and reports what it observed and tested. Anything it can't check is listed as not tested." },
];

export default async function FreeRiskScannerPage() {
  // Signed in with a workspace: the scanner is the dashboard page where the agents are.
  const session = await auth();
  if (session?.user?.id) {
    const membership = await getActiveMembership(session.user.id);
    redirect(membership ? "/risk-scan" : "/onboarding");
  }

  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pt-14 pb-8 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <ScannerOrb className="mx-auto mb-5" />
          <p className="aegis-eyebrow">Free Risk Scanner</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">Scan a real AI agent.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-pretty text-muted-foreground">
            Connect an AI agent first. Aegis connects to your real agent, verifies it, then shows concrete security findings — what it observed and what it tested.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/sign-up?from=scan" size="lg">
              Connect Agent
            </ButtonLink>
            <ButtonLink href="/sign-in?callbackUrl=%2Frisk-scan" size="lg" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Free. Creating a workspace is the only setup.</p>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-center text-xl font-semibold tracking-tight text-foreground">How it works</h2>
          <ol className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title}>
                <Icon className="size-5 text-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {i + 1}. {title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <div className="flex items-start gap-3">
            <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-foreground">What the scan does not test</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                It does not test your agent&rsquo;s prompts, source code or model behavior. It is read-only: it never contacts, controls or runs anything on your agent, and it does not produce a score.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
