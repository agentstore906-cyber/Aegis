"use client";

import { useEffect, useState } from "react";
import { Sparkles, User, Users, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";
import { createPersonalWorkspaceAction } from "@/lib/organizations/actions";
import { trackEvent } from "@/lib/analytics/track";
import { cn } from "@/lib/utils";

type Step = "welcome" | "type" | "workspace";
type TeamOrEnterprise = "TEAM" | "ENTERPRISE";

const WORKSPACE_COPY: Record<TeamOrEnterprise, { title: string; description: string; placeholder: string }> = {
  TEAM: {
    title: "Name your team",
    description: "One workspace for your team. You can invite teammates later.",
    placeholder: "Northstar Labs",
  },
  ENTERPRISE: {
    title: "Name your organization",
    description: "One workspace for your organization. You can invite teammates and configure governance later.",
    placeholder: "Northstar Labs Inc.",
  },
};

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>("welcome");
  const [accountType, setAccountType] = useState<TeamOrEnterprise>("TEAM");

  useEffect(() => {
    trackEvent("onboarding_started");
  }, []);

  // "type" and "workspace" are both step 2 of 3 — the workspace-naming
  // screen is a continuation of "tell us about your workspace," not a new
  // step — so this still lines up with /onboarding/connect's "Step 3 of 3".
  const stepNumber = step === "welcome" ? 1 : 2;

  return (
    <div>
      <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Step {stepNumber} of 3
      </p>

      {step === "welcome" && (
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted">
            <Sparkles className="size-5 text-brand" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Welcome to Aegis.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The control center for AI agents. Let&rsquo;s get you set up — it only takes a minute.
          </p>
          <Button type="button" className="mt-6 w-full" onClick={() => setStep("type")}>
            Get started
          </Button>
        </div>
      )}

      {step === "type" && (
        <div>
          <div className="mb-6 text-center">
            <h1 className="text-lg font-semibold text-foreground">What best describes you?</h1>
            <p className="mt-1 text-sm text-muted-foreground">This shapes how your dashboard is set up.</p>
          </div>

          <div className="space-y-3">
            <form action={createPersonalWorkspaceAction}>
              <TypeOption
                icon={User}
                title="Personal"
                description="I'm managing my own AI agents."
                type="submit"
              />
            </form>

            <TypeOption
              icon={Users}
              title="Team / Startup"
              description="A small team managing agents together."
              type="button"
              onClick={() => {
                setAccountType("TEAM");
                setStep("workspace");
              }}
            />

            <TypeOption
              icon={Building2}
              title="Company / Enterprise"
              description="An organization with many agents, governance, and permissions."
              type="button"
              onClick={() => {
                setAccountType("ENTERPRISE");
                setStep("workspace");
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setStep("welcome")}
            className="focus-ring mt-4 w-full rounded-sm text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}

      {step === "workspace" && (
        <div>
          <div className="mb-6 text-center">
            <h1 className="text-lg font-semibold text-foreground">{WORKSPACE_COPY[accountType].title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{WORKSPACE_COPY[accountType].description}</p>
          </div>
          <CreateOrganizationForm accountType={accountType} placeholder={WORKSPACE_COPY[accountType].placeholder} />
          <button
            type="button"
            onClick={() => setStep("type")}
            className="focus-ring mt-4 w-full rounded-sm text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

function TypeOption({
  icon: Icon,
  title,
  description,
  type,
  onClick,
}: {
  icon: typeof User;
  title: string;
  description: string;
  type: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        "focus-ring group flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-muted"
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted group-hover:bg-surface">
        <Icon className="size-4 text-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
