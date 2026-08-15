import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import type { OnboardingStatus } from "@/lib/onboarding/status";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STEPS: { key: keyof Omit<OnboardingStatus, "complete">; label: string; href: string }[] = [
  { key: "agentConnected", label: "Connect your first agent", href: "/agents/new" },
  { key: "firstEventReceived", label: "Receive your first event", href: "/developers/quickstart" },
  { key: "firstPolicyCreated", label: "Create your first policy", href: "/policies/new" },
  { key: "firstEvaluationCompleted", label: "Evaluate your first action", href: "/policies/test" },
  { key: "approvalWorkflowUsed", label: "Try an approval workflow", href: "/approvals" },
  { key: "teammateInvited", label: "Invite a teammate", href: "/settings/organization" },
];

/**
 * Shown on /overview only while incomplete — every step is auto-detected
 * from real data (lib/onboarding/status.ts), never a manually-checked box.
 * Disappears on its own once every step is done, so it needs no dismiss
 * control or stored preference.
 */
export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  if (status.complete) return null;

  const doneCount = STEPS.filter((step) => status[step.key]).length;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Get set up with Aegis</CardTitle>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {doneCount} of {STEPS.length} done
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {STEPS.map((step) => {
            const done = status[step.key];
            return (
              <li key={step.key}>
                <Link
                  href={step.href}
                  className={cn(
                    "focus-ring flex items-center gap-2.5 px-5 py-3 text-sm hover:bg-surface-muted",
                    done ? "text-muted-foreground" : "text-foreground"
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  )}
                  <span className={cn(done && "line-through decoration-muted-foreground/40")}>{step.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
