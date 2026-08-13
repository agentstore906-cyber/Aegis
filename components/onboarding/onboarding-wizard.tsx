"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";
import { trackEvent } from "@/lib/analytics/track";

type Step = "welcome" | "workspace";

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>("welcome");

  useEffect(() => {
    trackEvent("onboarding_started");
  }, []);

  const stepNumber = step === "welcome" ? 1 : 2;

  return (
    <div>
      <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Step {stepNumber} of 3
      </p>

      {step === "welcome" ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted">
            <Sparkles className="size-5 text-brand" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Welcome to Aegis.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The control plane for AI agents. Let&rsquo;s get your workspace set up — it only
            takes a minute.
          </p>
          <Button type="button" className="mt-6 w-full" onClick={() => setStep("workspace")}>
            Get started
          </Button>
        </div>
      ) : (
        <div>
          <div className="mb-6 text-center">
            <h1 className="text-lg font-semibold text-foreground">Create your workspace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One workspace per company. You can invite teammates later.
            </p>
          </div>
          <CreateOrganizationForm />
          <button
            type="button"
            onClick={() => setStep("welcome")}
            className="focus-ring mt-4 w-full rounded-sm text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
