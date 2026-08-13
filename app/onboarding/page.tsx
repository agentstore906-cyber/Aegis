import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getUserMemberships } from "@/lib/organizations/queries";
import { Logo } from "@/components/ui/logo";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const memberships = await getUserMemberships(user.id);

  if (memberships.length > 0) {
    redirect("/overview");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
        <OnboardingWizard />
      </div>
    </div>
  );
}
