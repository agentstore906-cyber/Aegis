import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, CirclePlay } from "lucide-react";

import { requireActiveOrganization } from "@/lib/organizations/queries";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Connect your first agent" };

export default async function OnboardingConnectPage() {
  await requireActiveOrganization();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface p-7 shadow-sm sm:p-9">
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step 3 of 3
        </p>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-foreground">Connect your first agent.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose how you&rsquo;d like to start — you can always do the other one later.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/agents/new"
            className="focus-ring group flex flex-col rounded-lg border border-border p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-muted"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted group-hover:bg-surface">
              <Bot className="size-4 text-foreground" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">Connect an Agent</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Register a real agent and get an API key so it can start reporting activity.
            </p>
            <span className="mt-3 flex items-center gap-1 text-xs font-medium text-brand">
              Create agent
              <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          </Link>

          <Link
            href="/demo"
            className="focus-ring group flex flex-col rounded-lg border border-border p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-muted"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted group-hover:bg-surface">
              <CirclePlay className="size-4 text-foreground" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">Explore Demo</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              See Aegis in action with a fully populated sample workspace — no setup required.
            </p>
            <span className="mt-3 flex items-center gap-1 text-xs font-medium text-brand">
              Open demo
              <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          </Link>
        </div>

        <div className="mt-6 text-center">
          <ButtonLink href="/overview" variant="ghost" size="sm">
            Skip — go to dashboard
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
