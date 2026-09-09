"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { changeSubscriptionPlanAction, type BillingActionState } from "@/lib/billing/actions";

const initialState: BillingActionState = {};

export function BillingChangePlanButton({
  planId,
  label,
  variant = "secondary",
  className,
}: {
  planId: string;
  label: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const boundAction = changeSubscriptionPlanAction.bind(null, planId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      <Button type="submit" size="sm" variant={variant} className={cn("w-full", className)} disabled={pending}>
        {pending ? "Updating…" : label}
      </Button>
    </form>
  );
}
