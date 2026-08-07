import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getUserMemberships } from "@/lib/organizations/queries";
import { Logo } from "@/components/ui/logo";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";

export const metadata: Metadata = { title: "Create your workspace" };

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
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Create your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One workspace per company. You can invite teammates later.
          </p>
        </div>
        <CreateOrganizationForm />
      </div>
    </div>
  );
}
